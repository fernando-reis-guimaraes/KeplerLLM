const fs = require("fs");
const path = require("path");

// KeplerLLM fork: second-audit regression coverage. Every environment
// variable whose VALUE genuinely represents a boolean must resolve through
// the shared strict parser: only "true"/"1" (case-insensitive, whitespace
// trimmed) enable; unset, "false", "0", "", "null", and any other value
// disable. Mere presence must never enable a feature.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}

const {
  parseBooleanEnv,
} = require("../../utils/helpers/parseBooleanEnv");

const ENABLED = ["true", "TRUE", " true ", "1", " 1 "];
const DISABLED = [
  "false",
  "FALSE",
  " false ",
  "0",
  " 0 ",
  "",
  "null",
  "undefined",
  "yes",
  "no",
  "on",
  "off",
  "abc",
];

// Restores the env after fn() completes. Awaits async callbacks so the env
// is still set when their awaits resume (a bare `return fn()` would run the
// restore as soon as the pending promise is returned). Sync callbacks keep
// synchronous throw semantics.
function withEnv(name, value, fn) {
  const had = name in process.env;
  const saved = process.env[name];
  const restore = () => {
    if (had) process.env[name] = saved;
    else delete process.env[name];
  };
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") {
    return result.then(
      (resolved) => {
        restore();
        return resolved;
      },
      (error) => {
        restore();
        throw error;
      }
    );
  }
  restore();
  return result;
}

describe("strict boolean consistency matrix (second audit)", () => {
  const FLAGS = [
    "SIMPLE_SSO_ENABLED",
    "SIMPLE_SSO_NO_LOGIN",
    "EMBED_REQUIRE_ALLOWLIST",
    "ENABLE_HTTP_LOGGER",
    "ENABLE_HTTP_LOGGER_TIMESTAMPS",
    "ENABLE_HTTPS",
    "AWS_BEDROCK_STREAMING_DISABLED",
    "MCP_NO_COOLDOWN",
    "GENERIC_OPENAI_STREAMING_DISABLED",
    "GENERIC_OPEN_AI_REPORT_USAGE",
    "DISABLE_SWAGGER_DOCS",
    "DISABLE_TELEMETRY",
    "COLLECTOR_ALLOW_ANY_IP",
  ];

  it.each(FLAGS)("%s: true/1 -> true, false/0/''/abc -> false", (name) => {
    for (const value of ENABLED)
      expect(parseBooleanEnv(value)).toBe(true);
    expect(parseBooleanEnv(undefined)).toBe(false);
    for (const value of DISABLED)
      expect(parseBooleanEnv(value)).toBe(false);
    withEnv(name, undefined, () =>
      expect(parseBooleanEnv(process.env[name])).toBe(false)
    );
    withEnv(name, "false", () =>
      expect(parseBooleanEnv(process.env[name])).toBe(false)
    );
    withEnv(name, "0", () =>
      expect(parseBooleanEnv(process.env[name])).toBe(false)
    );
    withEnv(name, "", () =>
      expect(parseBooleanEnv(process.env[name])).toBe(false)
    );
    withEnv(name, "true", () =>
      expect(parseBooleanEnv(process.env[name])).toBe(true)
    );
    withEnv(name, "1", () =>
      expect(parseBooleanEnv(process.env[name])).toBe(true)
    );
    withEnv(name, "TRUE", () =>
      expect(parseBooleanEnv(process.env[name])).toBe(true)
    );
    withEnv(name, " true ", () =>
      expect(parseBooleanEnv(process.env[name])).toBe(true)
    );
    withEnv(name, "abc", () =>
      expect(parseBooleanEnv(process.env[name])).toBe(false)
    );
  });

  it("AGENT_SKILL_RERANKER_ENABLED keeps its default-true when unset", () => {
    const { ToolReranker } = require("../../utils/agents/aibitat/utils/toolReranker");
    withEnv("AGENT_SKILL_RERANKER_ENABLED", undefined, () =>
      expect(ToolReranker.isEnabled()).toBe(true)
    );
    for (const value of ENABLED) {
      withEnv("AGENT_SKILL_RERANKER_ENABLED", value, () =>
        expect(ToolReranker.isEnabled()).toBe(true)
      );
    }
    for (const value of DISABLED) {
      withEnv("AGENT_SKILL_RERANKER_ENABLED", value, () =>
        expect(ToolReranker.isEnabled()).toBe(false)
      );
    }
  });
});

describe("simple SSO flags", () => {
  const {
    simpleSSOEnabled,
    simpleSSOLoginDisabled,
  } = require("../../utils/middleware/simpleSSOEnabled");

  function mockResponse() {
    return {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
      json: jest.fn(),
      locals: {},
    };
  }

  it("simpleSSOLoginDisabled requires both flags to resolve true", () => {
    withEnv("SIMPLE_SSO_ENABLED", "true", () =>
      withEnv("SIMPLE_SSO_NO_LOGIN", "true", () =>
        expect(simpleSSOLoginDisabled()).toBe(true)
      )
    );
    withEnv("SIMPLE_SSO_ENABLED", "1", () =>
      withEnv("SIMPLE_SSO_NO_LOGIN", "1", () =>
        expect(simpleSSOLoginDisabled()).toBe(true)
      )
    );
    // Either side "false"/"0"/"" disables the combination.
    for (const bad of ["false", "0", "", "abc", undefined]) {
      withEnv("SIMPLE_SSO_ENABLED", bad, () =>
        withEnv("SIMPLE_SSO_NO_LOGIN", "true", () =>
          expect(simpleSSOLoginDisabled()).toBe(false)
        )
      );
      withEnv("SIMPLE_SSO_ENABLED", "true", () =>
        withEnv("SIMPLE_SSO_NO_LOGIN", bad, () =>
          expect(simpleSSOLoginDisabled()).toBe(false)
        )
      );
    }
  });

  it("simpleSSOEnabled middleware 403s unless the flag resolves true", async () => {
    for (const value of [...DISABLED, undefined]) {
      await withEnv("SIMPLE_SSO_ENABLED", value, async () => {
        const response = mockResponse();
        const next = jest.fn();
        await simpleSSOEnabled({}, response, next);
        expect(next).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(403);
      });
    }
    for (const value of ENABLED) {
      await withEnv("SIMPLE_SSO_ENABLED", value, async () => {
        const response = mockResponse();
        response.locals.multiUserMode = true;
        const next = jest.fn();
        await simpleSSOEnabled({}, response, next);
        expect(next).toHaveBeenCalledTimes(1);
      });
    }
  });

  it("SystemSettings no longer uses presence for SSO flags", () => {
    const source = readRepoFile("server", "models", "systemSettings.js");
    expect(source).not.toContain('"SIMPLE_SSO_ENABLED" in process.env || false');
    expect(source).not.toContain('"SIMPLE_SSO_NO_LOGIN" in process.env || false');
    expect(source).toContain("parseBooleanEnv(process.env.SIMPLE_SSO_ENABLED)");
    expect(source).toContain("parseBooleanEnv(process.env.SIMPLE_SSO_NO_LOGIN)");
  });
});

describe("streaming-disabled flags", () => {
  const {
    AWSBedrockLLM,
  } = require("../../utils/AiProviders/bedrock/index");
  const AWSBedrockProvider = require("../../utils/agents/aibitat/providers/bedrock");
  const {
    GenericOpenAiLLM,
  } = require("../../utils/AiProviders/genericOpenAi/index");
  const GenericOpenAiProvider = require("../../utils/agents/aibitat/providers/genericOpenAi");

  it("AWS_BEDROCK_STREAMING_DISABLED=false/0/'' keeps streaming; true/1 disables", () => {
    const streamingThis = { streamGetChatCompletion() {} };
    withEnv("AWS_BEDROCK_STREAMING_DISABLED", undefined, () => {
      expect(
        AWSBedrockLLM.prototype.streamingEnabled.call(streamingThis)
      ).toBe(true);
      expect(
        Object.getOwnPropertyDescriptor(
          AWSBedrockProvider.prototype,
          "supportsAgentStreaming"
        ).get.call({})
      ).toBe(true);
    });
    for (const value of ENABLED) {
      withEnv("AWS_BEDROCK_STREAMING_DISABLED", value, () => {
        expect(
          AWSBedrockLLM.prototype.streamingEnabled.call(streamingThis)
        ).toBe(false);
        expect(
          Object.getOwnPropertyDescriptor(
            AWSBedrockProvider.prototype,
            "supportsAgentStreaming"
          ).get.call({})
        ).toBe(false);
      });
    }
    for (const value of DISABLED) {
      withEnv("AWS_BEDROCK_STREAMING_DISABLED", value, () => {
        expect(
          AWSBedrockLLM.prototype.streamingEnabled.call(streamingThis)
        ).toBe(true);
        expect(
          Object.getOwnPropertyDescriptor(
            AWSBedrockProvider.prototype,
            "supportsAgentStreaming"
          ).get.call({})
        ).toBe(true);
      });
    }
  });

  it("GENERIC_OPENAI_STREAMING_DISABLED=false/0/'' keeps streaming; true/1 disables", () => {
    const streamingThis = { streamGetChatCompletion() {} };
    withEnv("GENERIC_OPENAI_STREAMING_DISABLED", undefined, () => {
      expect(
        GenericOpenAiLLM.prototype.streamingEnabled.call(streamingThis)
      ).toBe(true);
      expect(
        Object.getOwnPropertyDescriptor(
          GenericOpenAiProvider.prototype,
          "supportsAgentStreaming"
        ).get.call({})
      ).toBe(true);
    });
    for (const value of ENABLED) {
      withEnv("GENERIC_OPENAI_STREAMING_DISABLED", value, () => {
        expect(
          GenericOpenAiLLM.prototype.streamingEnabled.call(streamingThis)
        ).toBe(false);
        expect(
          Object.getOwnPropertyDescriptor(
            GenericOpenAiProvider.prototype,
            "supportsAgentStreaming"
          ).get.call({})
        ).toBe(false);
      });
    }
    for (const value of DISABLED) {
      withEnv("GENERIC_OPENAI_STREAMING_DISABLED", value, () => {
        expect(
          GenericOpenAiLLM.prototype.streamingEnabled.call(streamingThis)
        ).toBe(true);
        expect(
          Object.getOwnPropertyDescriptor(
            GenericOpenAiProvider.prototype,
            "supportsAgentStreaming"
          ).get.call({})
        ).toBe(true);
      });
    }
  });
});

describe("MCP_NO_COOLDOWN", () => {
  const UnTooled = require("../../utils/agents/aibitat/providers/helpers/untooled");

  it("false/0/'' keep cooldown checks; true/1 skip them", () => {
    const fnCall = { name: "my-tool" };
    const functions = [{ name: "my-tool", isMCPTool: true }];
    withEnv("MCP_NO_COOLDOWN", undefined, () =>
      expect(
        UnTooled.prototype.isMCPTool.call({}, fnCall, functions)
      ).toBe(true)
    );
    for (const value of ENABLED) {
      withEnv("MCP_NO_COOLDOWN", value, () =>
        expect(
          UnTooled.prototype.isMCPTool.call({}, fnCall, functions)
        ).toBe(false)
      );
    }
    for (const value of DISABLED) {
      withEnv("MCP_NO_COOLDOWN", value, () =>
        expect(
          UnTooled.prototype.isMCPTool.call({}, fnCall, functions)
        ).toBe(true)
      );
    }
  });
});

describe("DISABLE_SWAGGER_DOCS", () => {
  const { useSwagger } = require("../../swagger/utils");

  function mockApp() {
    return { use: jest.fn(), get: jest.fn() };
  }

  it("false/0/''/unset mount docs; true/1 skip them", () => {
    for (const value of [...DISABLED, undefined]) {
      withEnv("DISABLE_SWAGGER_DOCS", value, () => {
        const app = mockApp();
        useSwagger(app);
        expect(app.use).toHaveBeenCalled();
      });
    }
    for (const value of ENABLED) {
      withEnv("DISABLE_SWAGGER_DOCS", value, () => {
        const app = mockApp();
        useSwagger(app);
        expect(app.use).not.toHaveBeenCalled();
        expect(app.get).not.toHaveBeenCalled();
      });
    }
  });
});

describe("DISABLE_TELEMETRY enforcement", () => {
  const { Telemetry } = require("../../models/telemetry");

  it("false/0/''/unset keep the client; true/1 return null", () => {
    for (const value of [...DISABLED, undefined]) {
      withEnv("DISABLE_TELEMETRY", value, () => {
        expect(Telemetry.client()).not.toBe(null);
      });
    }
    for (const value of ENABLED) {
      withEnv("DISABLE_TELEMETRY", value, () => {
        expect(Telemetry.client()).toBe(null);
      });
    }
  });
});

describe("ENABLE_HTTPS single-parse consistency", () => {
  it("server/index.js parses once and both boot branches share the result", () => {
    const source = readRepoFile("server", "index.js");
    expect(source).toContain(
      "parseBooleanEnv(process.env.ENABLE_HTTPS)"
    );
    expect(source).not.toContain("!!process.env.ENABLE_HTTPS");
    expect(source).not.toContain("if (!process.env.ENABLE_HTTPS)");
    // Both boot decisions flow from the single parsed constant.
    expect(source).toContain("if (httpsEnabled)");
    expect(source).toContain("if (!httpsEnabled) bootHTTP");
  });
});

describe("COLLECTOR_ALLOW_ANY_IP wire compatibility", () => {
  it("parsed booleans still satisfy the collector String() validation", () => {
    const validate = (value) => String(value) === "true";
    for (const value of ENABLED)
      expect(validate(parseBooleanEnv(value))).toBe(true);
    for (const value of [...DISABLED, undefined])
      expect(validate(parseBooleanEnv(value))).toBe(false);
  });

  it("collectorApi no longer forwards the raw string", () => {
    const source = readRepoFile(
      "server",
      "utils",
      "collectorApi",
      "index.js"
    );
    expect(source).not.toContain(
      "process.env.COLLECTOR_ALLOW_ANY_IP ?? "
    );
    expect(source).toContain(
      "parseBooleanEnv(process.env.COLLECTOR_ALLOW_ANY_IP)"
    );
  });
});

describe("migrated locations use the shared parser (no presence/truthiness)", () => {
  it("embed allowlist locations", () => {
    const embedConfig = readRepoFile("server", "models", "embedConfig.js");
    const middleware = readRepoFile(
      "server",
      "utils",
      "middleware",
      "embedMiddleware.js"
    );
    expect(embedConfig).not.toContain(
      '"EMBED_REQUIRE_ALLOWLIST" in process.env'
    );
    expect(middleware).not.toContain(
      '"EMBED_REQUIRE_ALLOWLIST" in process.env'
    );
    expect(embedConfig).toContain("parseBooleanEnv");
    expect(middleware).toContain("parseBooleanEnv");
  });

  it("telemetry enforcement locations", () => {
    for (const segments of [
      ["server", "models", "telemetry.js"],
      ["server", "utils", "telemetry", "index.js"],
      ["server", "utils", "database", "index.js"],
    ]) {
      const source = readRepoFile(...segments);
      expect(source).not.toContain(
        'process.env.DISABLE_TELEMETRY === "true"'
      );
      expect(source).toContain("parseBooleanEnv");
    }
  });

  it("report-usage and swagger locations", () => {
    const provider = readRepoFile(
      "server",
      "utils",
      "AiProviders",
      "genericOpenAi",
      "index.js"
    );
    expect(provider).not.toContain(
      '"GENERIC_OPEN_AI_REPORT_USAGE" in process.env'
    );
    expect(provider).not.toContain(
      'process.env.GENERIC_OPEN_AI_REPORT_USAGE !== "true"'
    );
    const swagger = readRepoFile("server", "swagger", "utils.js");
    expect(swagger).not.toContain(
      'process.env.DISABLE_SWAGGER_DOCS === "true"'
    );
  });

  it("credential presence checks keep their existing meaning", () => {
    const systemSettings = readRepoFile(
      "server",
      "models",
      "systemSettings.js"
    );
    expect(systemSettings).toContain("!!process.env.OPEN_AI_KEY");
    expect(systemSettings).toContain("!!process.env.AUTH_TOKEN");
    expect(systemSettings).toContain("!!process.env.ANTHROPIC_API_KEY");
  });
});
