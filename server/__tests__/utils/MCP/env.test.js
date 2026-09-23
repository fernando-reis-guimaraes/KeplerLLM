const path = require("path");
const fs = require("fs");
const os = require("os");

// pkce-challenge (used by the MCP SDK's OAuth support, which these tests
// never exercise) is ESM-only under the hood and cannot be loaded by jest
// without --experimental-vm-modules.
jest.mock("pkce-challenge", () => ({
  default: async () => ({ code_verifier: "", code_challenge: "" }),
}));

const {
  MCP_ENV_PREFIX,
  normalizeEnvServerName,
  isMCPEnvCandidate,
  isValidRemoteHttpUrl,
  parseMCPEnvValue,
  parseMCPEnvironment,
  mergeMCPDefinitions,
  safeDomainForUrl,
  effectiveServerType,
  sanitizeErrorMessage,
  sanitizeServerForFrontend,
} = require("../../../utils/MCP/env");
const MCPHypervisor = require("../../../utils/MCP/hypervisor");
const MCPCompatibilityLayer = require("../../../utils/MCP");

// ---------------------------------------------------------------------------
// Env isolation: never leak the developer machine's real MCP_* values into
// tests, and never let them pollute assertions.
// ---------------------------------------------------------------------------
let savedMCPEnv = {};
function snapshotMCPEnv() {
  savedMCPEnv = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(MCP_ENV_PREFIX)) savedMCPEnv[key] = process.env[key];
  }
}
function clearMCPEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(MCP_ENV_PREFIX)) delete process.env[key];
  }
}
function restoreMCPEnv() {
  clearMCPEnv();
  for (const [key, value] of Object.entries(savedMCPEnv)) {
    process.env[key] = value;
  }
  savedMCPEnv = {};
}

beforeEach(() => {
  snapshotMCPEnv();
  clearMCPEnv();
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  restoreMCPEnv();
  jest.restoreAllMocks();
});

describe("normalizeEnvServerName", () => {
  it("normalizes MCP_CLASSLOG_BANCO_DADOS -> classlog-banco-dados", () => {
    expect(normalizeEnvServerName("MCP_CLASSLOG_BANCO_DADOS")).toBe(
      "classlog-banco-dados"
    );
  });

  it("normalizes MCP_GITHUB_READONLY -> github-readonly", () => {
    expect(normalizeEnvServerName("MCP_GITHUB_READONLY")).toBe(
      "github-readonly"
    );
  });

  it("normalizes MCP_CLASSLOG_CODIGO_FONTE -> classlog-codigo-fonte", () => {
    expect(normalizeEnvServerName("MCP_CLASSLOG_CODIGO_FONTE")).toBe(
      "classlog-codigo-fonte"
    );
  });

  it("lowercases and replaces every underscore", () => {
    expect(normalizeEnvServerName("MCP_Foo_Bar_BAZ")).toBe("foo-bar-baz");
  });
});

describe("parseMCPEnvValue - URL only", () => {
  it("parses a URL-only definition as streamable", () => {
    const parsed = parseMCPEnvValue("https://example.com/secret/mcp");
    expect(parsed.ok).toBe(true);
    expect(parsed.config).toEqual({
      type: "streamable",
      url: "https://example.com/secret/mcp",
    });
  });

  it("accepts http:// URLs", () => {
    const parsed = parseMCPEnvValue("http://localhost:3000/mcp");
    expect(parsed.ok).toBe(true);
    expect(parsed.config.type).toBe("streamable");
  });
});

describe("parseMCPEnvValue - Bearer auth", () => {
  it.each(["Bearer", "bearer", "BEARER", "BeArEr"])(
    "accepts %s case-insensitively with canonical Bearer spelling",
    (keyword) => {
      const parsed = parseMCPEnvValue(
        `https://example.com/mcp|${keyword}|abc123`
      );
      expect(parsed.ok).toBe(true);
      expect(parsed.config).toEqual({
        type: "streamable",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer abc123" },
      });
    }
  );
});

describe("parseMCPEnvValue - Basic auth", () => {
  it("encodes Username:Password as Basic", () => {
    const parsed = parseMCPEnvValue(
      "https://example.com/mcp|Basic|Fernando:Secret"
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.config.type).toBe("streamable");
    expect(parsed.config.url).toBe("https://example.com/mcp");
    const value = parsed.config.headers.Authorization;
    expect(value.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(value.slice("Basic ".length), "base64").toString(
      "utf8"
    );
    expect(decoded).toBe("Fernando:Secret");
  });

  it("is case-insensitive for the Basic keyword", () => {
    for (const keyword of ["Basic", "basic", "BASIC", "bAsIc"]) {
      const parsed = parseMCPEnvValue(
        `https://example.com/mcp|${keyword}|Fernando:Secret`
      );
      expect(parsed.ok).toBe(true);
      expect(parsed.config.headers.Authorization.startsWith("Basic ")).toBe(
        true
      );
    }
  });

  it("splits credentials on the FIRST colon only", () => {
    const parsed = parseMCPEnvValue(
      "https://example.com/mcp|Basic|Fernando:one:two:three"
    );
    expect(parsed.ok).toBe(true);
    const value = parsed.config.headers.Authorization;
    const decoded = Buffer.from(value.slice("Basic ".length), "base64").toString(
      "utf8"
    );
    expect(decoded).toBe("Fernando:one:two:three");
  });

  it("uses exactly Username:Password (not Basic|user|pass)", () => {
    // |Basic|user|pass would be Basic credential "user" (no colon) plus a
    // dangling "pass" segment: invalid, not silently accepted.
    const parsed = parseMCPEnvValue("https://example.com/mcp|Basic|user|pass");
    expect(parsed.ok).toBe(false);
  });
});

describe("parseMCPEnvValue - arbitrary headers", () => {
  it("preserves header names and values verbatim", () => {
    const parsed = parseMCPEnvValue(
      "https://example.com/mcp|X-USER|ABC|x-Custom|DEF"
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.config.headers).toEqual({
      "X-USER": "ABC",
      "x-Custom": "DEF",
    });
  });

  it("does not lowercase or rename custom headers", () => {
    const parsed = parseMCPEnvValue(
      "https://example.com/mcp|x-custom-Header|ABC"
    );
    expect(parsed.ok).toBe(true);
    expect(Object.keys(parsed.config.headers)).toEqual(["x-custom-Header"]);
  });
});

describe("parseMCPEnvValue - auth plus additional headers", () => {
  it("supports Bearer plus custom headers", () => {
    const parsed = parseMCPEnvValue(
      "https://example.com/mcp|Bearer|TOKEN|X-USER|ABC"
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.config.headers).toEqual({
      Authorization: "Bearer TOKEN",
      "X-USER": "ABC",
    });
  });

  it("supports Basic plus custom headers", () => {
    const parsed = parseMCPEnvValue(
      "https://example.com/mcp|Basic|Fernando:Secret|X-APP|Classlog"
    );
    expect(parsed.ok).toBe(true);
    expect(
      parsed.config.headers.Authorization.startsWith("Basic ")
    ).toBe(true);
    expect(parsed.config.headers["X-APP"]).toBe("Classlog");
  });

  it("supports Bearer plus multiple custom headers", () => {
    const parsed = parseMCPEnvValue(
      "https://example.com/mcp|Bearer|TOKEN|X-USER|Fernando|X-APP|Classlog"
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.config.headers).toEqual({
      Authorization: "Bearer TOKEN",
      "X-USER": "Fernando",
      "X-APP": "Classlog",
    });
  });
});

describe("parseMCPEnvValue - malformed definitions", () => {
  it("rejects Bearer without a token", () => {
    expect(parseMCPEnvValue("https://example.com/mcp|Bearer").ok).toBe(false);
    expect(parseMCPEnvValue("https://example.com/mcp|Bearer|").ok).toBe(false);
  });

  it("rejects Basic without credentials", () => {
    expect(parseMCPEnvValue("https://example.com/mcp|Basic").ok).toBe(false);
  });

  it("rejects Basic without a colon", () => {
    expect(parseMCPEnvValue("https://example.com/mcp|Basic|NoColon").ok).toBe(
      false
    );
  });

  it("rejects Basic with empty username or password", () => {
    expect(parseMCPEnvValue("https://example.com/mcp|Basic|:pass").ok).toBe(
      false
    );
    expect(parseMCPEnvValue("https://example.com/mcp|Basic|user:").ok).toBe(
      false
    );
  });

  it("rejects a header pair with a missing value", () => {
    const parsed = parseMCPEnvValue("https://example.com/mcp|X-USER");
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/pairs/);
  });

  it("does not leak secrets in error messages", () => {
    const parsed = parseMCPEnvValue("https://example.com/mcp|X-USER");
    expect(parsed.ok).toBe(false);
    expect(parsed.error).not.toMatch(/X-USER/);
    expect(JSON.stringify(parsed)).not.toMatch(/Bearer|TOKEN/);
  });

  it("rejects invalid URLs safely", () => {
    expect(parseMCPEnvValue("not-a-url").ok).toBe(false);
    expect(parseMCPEnvValue("ftp://example.com/mcp").ok).toBe(false);
    expect(parseMCPEnvValue("").ok).toBe(false);
  });
});

describe("pipe delimiter behavior", () => {
  it("uses | as a reserved delimiter with no escaping", () => {
    // A literal pipe inside a value simply splits: there is no `\|` support.
    // "a|b" as a header value becomes two segments and fails pair parsing.
    const parsed = parseMCPEnvValue("https://example.com/mcp|X-HEADER|a|b");
    expect(parsed.ok).toBe(false);
  });

  it("documents that values with literal pipes are unsupported", () => {
    const parts = "https://example.com/mcp|Bearer|tok|en".split("|");
    expect(parts).toEqual([
      "https://example.com/mcp",
      "Bearer",
      "tok",
      "en",
    ]);
  });
});

describe("isMCPEnvCandidate / isValidRemoteHttpUrl", () => {
  it("treats http(s) first segments as candidates", () => {
    expect(isMCPEnvCandidate("https://example.com/mcp")).toBe(true);
    expect(
      isMCPEnvCandidate("https://example.com/mcp|Bearer|TOKEN")
    ).toBe(true);
    expect(isMCPEnvCandidate("http://localhost:3000/mcp")).toBe(true);
  });

  it("ignores non-URL values (e.g. feature flags)", () => {
    expect(isMCPEnvCandidate("true")).toBe(false);
    expect(isMCPEnvCandidate("1")).toBe(false);
    expect(isMCPEnvCandidate("")).toBe(false);
    expect(isMCPEnvCandidate(undefined)).toBe(false);
  });

  it("validates remote http/https URLs", () => {
    expect(isValidRemoteHttpUrl("https://example.com/mcp")).toBe(true);
    expect(isValidRemoteHttpUrl("http://localhost:3000/mcp")).toBe(true);
    expect(isValidRemoteHttpUrl("ftp://example.com/mcp")).toBe(false);
    expect(isValidRemoteHttpUrl("not a url")).toBe(false);
  });
});

describe("parseMCPEnvironment", () => {
  it("discovers MCP_* http definitions with normalized names", () => {
    const { servers, errors } = parseMCPEnvironment({
      MCP_CLASSLOG_BANCO_DADOS: "https://pg.example.com/XXX/mcp",
      MCP_GITHUB_READONLY: "https://src.example.com/XXX/mcp|Bearer|TOKEN",
    });
    expect(errors).toEqual({});
    expect(Object.keys(servers).sort()).toEqual([
      "classlog-banco-dados",
      "github-readonly",
    ]);
    expect(servers["classlog-banco-dados"].config).toEqual({
      type: "streamable",
      url: "https://pg.example.com/XXX/mcp",
    });
    expect(
      servers["github-readonly"].config.headers.Authorization
    ).toBe("Bearer TOKEN");
  });

  it("ignores MCP_NO_COOLDOWN even with a URL-like value", () => {
    const { servers } = parseMCPEnvironment({
      MCP_NO_COOLDOWN: "https://example.com/mcp",
      MCP_REAL: "https://example.com/mcp",
    });
    expect(servers["no-cooldown"]).toBeUndefined();
    expect(servers["real"]).toBeDefined();
  });

  it("ignores MCP_* values that are not http(s) URLs", () => {
    const { servers, errors } = parseMCPEnvironment({
      MCP_NO_COOLDOWN: "true",
      MCP_SOME_FLAG: "1",
      OTHER_VAR: "https://example.com/mcp",
    });
    expect(servers).toEqual({});
    expect(errors).toEqual({});
  });

  it("records invalid definitions per-server without throwing", () => {
    const { servers, errors } = parseMCPEnvironment({
      MCP_GOOD: "https://example.com/mcp",
      MCP_BAD: "https://example.com/mcp|Bearer",
    });
    expect(servers["good"]).toBeDefined();
    expect(servers["bad"]).toBeUndefined();
    expect(errors["bad"]).toBeDefined();
    expect(errors["bad"].message).toMatch(/Bearer/);
    // Error metadata must not contain the secret value.
    expect(JSON.stringify(errors)).not.toMatch(/SUPER-SECRET/);
  });
});

describe("mergeMCPDefinitions", () => {
  it("prefers environment over file for the same name", () => {
    const { servers, sources } = mergeMCPDefinitions(
      {
        "classlog-banco-dados": {
          type: "streamable",
          url: "https://old.example.com/mcp",
        },
      },
      {
        "classlog-banco-dados": {
          envKey: "MCP_CLASSLOG_BANCO_DADOS",
          config: {
            type: "streamable",
            url: "https://new.example.com/mcp",
          },
        },
      }
    );
    expect(servers["classlog-banco-dados"].url).toBe(
      "https://new.example.com/mcp"
    );
    expect(sources["classlog-banco-dados"]).toBe("environment");
  });

  it("keeps the file definition when no env override exists", () => {
    const { servers, sources } = mergeMCPDefinitions(
      {
        "file-only": {
          type: "streamable",
          url: "https://file.example.com/mcp",
        },
      },
      {}
    );
    expect(servers["file-only"].url).toBe("https://file.example.com/mcp");
    expect(sources["file-only"]).toBe("file");
  });

  it("preserves safe anythingllm metadata on env override", () => {
    const { servers } = mergeMCPDefinitions(
      {
        "my-server": {
          type: "streamable",
          url: "https://old.example.com/mcp",
          anythingllm: { suppressedTools: ["secret-tool"], autoStart: true },
        },
      },
      {
        "my-server": {
          envKey: "MCP_MY_SERVER",
          config: {
            type: "streamable",
            url: "https://new.example.com/mcp",
          },
        },
      }
    );
    expect(servers["my-server"].url).toBe("https://new.example.com/mcp");
    expect(servers["my-server"].anythingllm).toEqual({
      suppressedTools: ["secret-tool"],
      autoStart: true,
    });
  });

  it("leaves existing stdio definitions untouched", () => {
    const stdio = { command: "npx", args: ["-y", "some-mcp"] };
    const { servers, sources } = mergeMCPDefinitions(
      { "my-stdio": stdio },
      {}
    );
    expect(servers["my-stdio"]).toEqual(stdio);
    expect(sources["my-stdio"]).toBe("file");
  });

  it("leaves existing SSE definitions untouched", () => {
    const sse = { type: "sse", url: "https://sse.example.com/events" };
    const { servers } = mergeMCPDefinitions({ "my-sse": sse }, {});
    expect(servers["my-sse"]).toEqual(sse);
  });

  it("leaves existing streamable definitions and headers untouched", () => {
    const streamable = {
      type: "streamable",
      url: "https://api.example.com/mcp",
      headers: { "X-Custom": "value" },
    };
    const { servers } = mergeMCPDefinitions(
      { "my-stream": streamable },
      {}
    );
    expect(servers["my-stream"]).toEqual(streamable);
  });
});

describe("safeDomainForUrl / effectiveServerType / sanitizeErrorMessage", () => {
  it("extracts only the host from a secret URL", () => {
    expect(
      safeDomainForUrl("https://mcp-pg.example.com/SUPER-SECRET/mcp?token=x")
    ).toBe("mcp-pg.example.com");
    expect(safeDomainForUrl("http://localhost:3000/mcp")).toBe(
      "localhost:3000"
    );
    expect(safeDomainForUrl("not a url")).toBeNull();
  });

  it("infers effective types", () => {
    expect(effectiveServerType({ type: "streamable" })).toBe("streamable");
    expect(effectiveServerType({ command: "npx" })).toBe("stdio");
    expect(effectiveServerType({ url: "https://example.com" })).toBe("sse");
  });

  it("redacts URLs embedded in error messages", () => {
    const redacted = sanitizeErrorMessage(
      "fetch failed for https://example.com/SUPER-SECRET/mcp?token=ALSO-SECRET"
    );
    expect(redacted).toMatch(/example\.com/);
    expect(redacted).not.toMatch(/SUPER-SECRET/);
    expect(redacted).not.toMatch(/ALSO-SECRET/);
    expect(redacted).not.toMatch(/\?token=/);
  });
});

describe("sanitizeServerForFrontend", () => {
  const SECRET_URL =
    "https://mcp-pg.example.com/SUPER-SECRET/mcp?token=ALSO-SECRET";
  const SECRET_HEADERS = {
    Authorization: "Bearer VERY-SECRET",
    "X-PASS": "PASSWORD",
  };

  function serialized(snapshot) {
    return JSON.stringify(snapshot);
  }

  it.each(["environment", "file"])(
    "exposes domain but never secrets for source=%s",
    (source) => {
      const safe = sanitizeServerForFrontend(
        "classlog-banco-dados",
        { type: "streamable", url: SECRET_URL, headers: SECRET_HEADERS },
        source
      );
      const blob = serialized(safe);
      expect(blob).toMatch(/mcp-pg\.example\.com/);
      expect(safe.domain).toBe("mcp-pg.example.com");
      expect(safe.source).toBe(source);
      for (const sentinel of [
        "SUPER-SECRET",
        "ALSO-SECRET",
        "VERY-SECRET",
        "PASSWORD",
        "/mcp",
        "?token=",
      ]) {
        expect(blob).not.toMatch(sentinalEscape(sentinel));
      }
      // Header names are acceptable; values are not.
      expect(safe.headerNames).toEqual(
        expect.arrayContaining(["Authorization", "X-PASS"])
      );
      expect(safe.config.headerNames).toEqual(
        expect.arrayContaining(["Authorization", "X-PASS"])
      );
      expect(safe.config.anythingllm).toBeDefined();
    }
  );

  it("never includes Basic credentials", () => {
    const parsed = parseMCPEnvValue(
      "https://example.com/mcp|Basic|Fernando:Secret"
    );
    const safe = sanitizeServerForFrontend(
      "basic-server",
      parsed.config,
      "environment"
    );
    const blob = serialized(safe);
    expect(blob).not.toMatch(/Fernando/);
    expect(blob).not.toMatch(/Secret/);
    expect(blob).not.toMatch(/Basic/);
    expect(safe.headerNames).toEqual(["Authorization"]);
  });

  it("preserves safe anythingllm metadata and stdio launch info", () => {
    const safe = sanitizeServerForFrontend(
      "my-stdio",
      {
        command: "npx",
        args: ["-y", "pkg"],
        env: { SECRET_KEY: "should-never-appear" },
        anythingllm: { suppressedTools: ["a"] },
      },
      "file"
    );
    expect(safe.config.anythingllm).toEqual({ suppressedTools: ["a"] });
    expect(safe.config.command).toBe("npx");
    expect(serialized(safe)).not.toMatch(/should-never-appear/);
    expect(serialized(safe)).not.toMatch(/SECRET_KEY/);
  });

  function sentinalEscape(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
});

// ---------------------------------------------------------------------------
// Hypervisor integration (temp storage, no live MCP servers needed)
// ---------------------------------------------------------------------------
describe("MCPHypervisor environment integration", () => {
  let storageDir;
  let hypervisor;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-env-"));
    process.env.STORAGE_DIR = storageDir;
    MCPHypervisor._instance = undefined;
    MCPCompatibilityLayer._instance = undefined;
  });

  afterEach(() => {
    if (hypervisor) {
      try {
        hypervisor.pruneMCPServers();
      } catch {}
    }
    MCPHypervisor._instance = undefined;
    MCPCompatibilityLayer._instance = undefined;
    hypervisor = undefined;
    delete process.env.STORAGE_DIR;
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  function writeFileConfig(servers) {
    fs.mkdirSync(path.join(storageDir, "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(storageDir, "plugins", "anythingllm_mcp_servers.json"),
      JSON.stringify({ mcpServers: servers }, null, 2)
    );
  }

  function readFileConfig() {
    return JSON.parse(
      fs.readFileSync(
        path.join(storageDir, "plugins", "anythingllm_mcp_servers.json"),
        "utf8"
      )
    );
  }

  it("discovers env servers as streamable with source=environment", () => {
    writeFileConfig({});
    process.env.MCP_FOO = "https://example.com/secret/mcp";
    hypervisor = new MCPHypervisor();
    const configs = hypervisor.mcpServerConfigs;
    const foo = configs.find((c) => c.name === "foo");
    expect(foo).toBeDefined();
    expect(foo.source).toBe("environment");
    expect(foo.server.type).toBe("streamable");
    expect(foo.server.url).toBe("https://example.com/secret/mcp");
  });

  it("env overrides a same-name file definition", () => {
    writeFileConfig({
      "classlog-banco-dados": {
        type: "streamable",
        url: "https://old.example.com/mcp",
      },
    });
    process.env.MCP_CLASSLOG_BANCO_DADOS = "https://new.example.com/mcp";
    hypervisor = new MCPHypervisor();
    const found = hypervisor.mcpServerConfigs.find(
      (c) => c.name === "classlog-banco-dados"
    );
    expect(found.server.url).toBe("https://new.example.com/mcp");
    expect(found.source).toBe("environment");
  });

  it("restores the file definition once the env override disappears", () => {
    writeFileConfig({
      "classlog-banco-dados": {
        type: "streamable",
        url: "https://old.example.com/mcp",
      },
    });
    process.env.MCP_CLASSLOG_BANCO_DADOS = "https://new.example.com/mcp";
    hypervisor = new MCPHypervisor();
    expect(
      hypervisor.mcpServerConfigs.find(
        (c) => c.name === "classlog-banco-dados"
      ).server.url
    ).toBe("https://new.example.com/mcp");

    delete process.env.MCP_CLASSLOG_BANCO_DADOS;
    const after = hypervisor.mcpServerConfigs.find(
      (c) => c.name === "classlog-banco-dados"
    );
    expect(after.server.url).toBe("https://old.example.com/mcp");
    expect(after.source).toBe("file");
  });

  it("records invalid env definitions as failed without crashing boot", async () => {
    writeFileConfig({});
    process.env.MCP_GOOD = "https://example.com/mcp|Bearer";
    process.env.MCP_ALSO_GOOD = "https://example.com/mcp";
    hypervisor = new MCPHypervisor();
    // Boot will try to connect to MCP_ALSO_GOOD and fail (no live server),
    // but MCP_GOOD is a parse error and must already be failed.
    const results = await hypervisor.bootMCPServers();
    expect(results["good"].status).toBe("failed");
    expect(results["good"].message).toMatch(/Invalid environment/);
    expect(JSON.stringify(results)).not.toMatch(/Bearer.*TOKEN/);
  });

  it("persists only safe anythingllm metadata for env-managed tool toggles", () => {
    writeFileConfig({});
    process.env.MCP_MY_SERVER = "https://example.com/secret/mcp|Bearer|TOKEN";
    hypervisor = new MCPHypervisor();
    const result = hypervisor.updateSuppressedTools(
      "my-server",
      "some-tool",
      false
    );
    expect(result.success).toBe(true);
    expect(result.suppressedTools).toEqual(["some-tool"]);
    const file = readFileConfig();
    expect(file.mcpServers["my-server"]).toEqual({
      anythingllm: { suppressedTools: ["some-tool"] },
    });
    expect(JSON.stringify(file)).not.toMatch(/example\.com/);
    expect(JSON.stringify(file)).not.toMatch(/TOKEN/);
  });

  it("rejects permanent delete of environment-managed servers", async () => {
    writeFileConfig({});
    process.env.MCP_MY_SERVER = "https://example.com/mcp";
    const layer = new MCPCompatibilityLayer();
    hypervisor = layer;
    const result = await layer.deleteServer("my-server");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/environment/i);
  });

  it("servers() exposes only safe hostnames for env and file sources", async () => {
    writeFileConfig({
      "file-secret": {
        type: "streamable",
        url: "https://mcp-pg.example.com/SUPER-SECRET/mcp?token=ALSO-SECRET",
        headers: {
          Authorization: "Bearer VERY-SECRET",
          "X-PASS": "PASSWORD",
        },
      },
    });
    process.env.MCP_ENV_SECRET =
      "https://mcp-pg.example.com/SUPER-SECRET/mcp?token=ALSO-SECRET|Bearer|VERY-SECRET";
    const layer = new MCPCompatibilityLayer();
    hypervisor = layer;

    // Mock running clients so servers() does not need live MCP endpoints.
    layer.mcps = {
      "file-secret": {
        ping: () => Promise.resolve(true),
        listTools: () => Promise.resolve({ tools: [] }),
        transport: {},
        close: () => {},
      },
      "env-secret": {
        ping: () => Promise.resolve(true),
        listTools: () => Promise.resolve({ tools: [] }),
        transport: {},
        close: () => {},
      },
    };
    layer.mcpLoadingResults = {
      "file-secret": { status: "success", message: "connected" },
      "env-secret": { status: "success", message: "connected" },
    };

    const servers = await layer.servers();
    const blob = JSON.stringify(servers);
    expect(blob).toMatch(/mcp-pg\.example\.com/);
    for (const sentinel of [
      "SUPER-SECRET",
      "ALSO-SECRET",
      "VERY-SECRET",
      "PASSWORD",
      "?token=",
    ]) {
      expect(blob).not.toContain(sentinel);
    }
    // Path segments must not leak either.
    expect(blob).not.toContain("/SUPER-SECRET/mcp");
    const envEntry = servers.find((s) => s.name === "env-secret");
    expect(envEntry.source).toBe("environment");
    expect(envEntry.domain).toBe("mcp-pg.example.com");
    const fileEntry = servers.find((s) => s.name === "file-secret");
    expect(fileEntry.source).toBe("file");
    expect(fileEntry.domain).toBe("mcp-pg.example.com");
  });
});
