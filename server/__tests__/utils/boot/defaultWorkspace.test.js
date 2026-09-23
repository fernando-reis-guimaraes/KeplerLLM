const fs = require("fs");
const os = require("os");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const { Workspace } = require("../../../models/workspace");
const {
  ENV_KEYS,
  parseDefaultWorkspaceConfig,
  bootstrapDefaultWorkspace,
} = require("../../../utils/boot/defaultWorkspace");

// ---------------------------------------------------------------------------
// Env isolation: never leak the developer machine's real DEFAULT_WORKSPACE_*
// values into tests.
// ---------------------------------------------------------------------------
const BOOTSTRAP_KEYS = Object.values(ENV_KEYS);
let savedEnv = {};
function snapshotEnv() {
  savedEnv = {};
  for (const key of BOOTSTRAP_KEYS) {
    if (key in process.env) savedEnv[key] = process.env[key];
  }
}
function clearEnv() {
  for (const key of BOOTSTRAP_KEYS) delete process.env[key];
}
function restoreEnv() {
  clearEnv();
  for (const [key, value] of Object.entries(savedEnv)) {
    process.env[key] = value;
  }
  savedEnv = {};
}

function envObject(overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }
  return env;
}

// In-memory Workspace model double. Reuses the real validation/slug logic
// so tests verify integration with upstream rules without needing a database.
// Persistence goes only through get/new/upsert, mirroring the allowed model
// layer. No raw SQL and no provider-specific branches.
function createFakeWorkspace({ defaultPrompt = Workspace.defaultPrompt } = {}) {
  const store = [];
  let nextId = 1;

  const model = {
    VALID_CHAT_MODES: Workspace.VALID_CHAT_MODES,
    defaultPrompt: Workspace.defaultPrompt,
    validations: Workspace.validations,
    validateFields: Workspace.validateFields.bind(Workspace),
    slugify: Workspace.slugify.bind(Workspace),
    _store: store,

    async get(clause = {}) {
      const found = store.find((item) =>
        Object.entries(clause).every(([key, value]) => item[key] === value)
      );
      return found ? { ...found } : null;
    },

    async new(name = null, _creatorId = null, additionalFields = {}) {
      if (!name) return { workspace: null, message: "name cannot be null" };
      var slug = Workspace.slugify(name, { lower: true });
      slug = slug || uuidv4();
      const existingBySlug = store.find((item) => item.slug === slug);
      if (existingBySlug !== null && existingBySlug !== undefined) {
        const slugSeed = Math.floor(10000000 + Math.random() * 90000000);
        slug = Workspace.slugify(`${name}-${slugSeed}`, { lower: true });
      }
      // Yield once so concurrent bootstraps interleave like real DB races.
      await Promise.resolve();
      if (store.find((item) => item.slug === slug)) {
        return {
          workspace: null,
          message: "Unique constraint failed on the fields: (`slug`)",
        };
      }
      const fields = { ...additionalFields };
      if (!fields.openAiPrompt) fields.openAiPrompt = defaultPrompt;
      const validated = Workspace.validateFields(fields);
      const workspace = {
        id: nextId++,
        name: Workspace.validations.name(name),
        chatMode: "automatic",
        ...validated,
        slug,
      };
      // Simulate Prisma column defaults (schema.prisma): openAiHistory
      // defaults to 20 and nullable openAiTemp defaults to null.
      if (workspace.openAiHistory === undefined) workspace.openAiHistory = 20;
      if (workspace.openAiTemp === undefined) workspace.openAiTemp = null;
      store.push(workspace);
      return { workspace: { ...workspace }, message: null };
    },

    async upsert(clause = {}, createData = {}, updateData = {}) {
      const found = store.find((item) =>
        Object.entries(clause).every(([key, value]) => item[key] === value)
      );
      if (found) {
        Object.assign(found, updateData);
        return { workspace: { ...found }, error: null };
      }
      await Promise.resolve();
      const raced = store.find((item) =>
        Object.entries(clause).every(([key, value]) => item[key] === value)
      );
      if (raced) return { workspace: { ...raced }, error: null };
      const workspace = { id: nextId++, ...createData };
      if (workspace.openAiHistory === undefined) workspace.openAiHistory = 20;
      if (workspace.openAiTemp === undefined) workspace.openAiTemp = null;
      store.push(workspace);
      return { workspace: { ...workspace }, error: null };
    },

    // Simulates a UI/API edit that bypasses bootstrap (database is truth).
    async directUpdate(slug, patch = {}) {
      const found = store.find((item) => item.slug === slug);
      if (!found) throw new Error(`workspace not found: ${slug}`);
      Object.assign(found, patch);
      return { ...found };
    },
  };

  const getSystemDefaultPrompt = async () => defaultPrompt;
  return { model, store, getSystemDefaultPrompt };
}

function silentLogger() {
  return { log: jest.fn(), error: jest.fn() };
}

beforeEach(() => {
  snapshotEnv();
  clearEnv();
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  restoreEnv();
  jest.restoreAllMocks();
});

describe("default workspace bootstrap: disabled behavior", () => {
  it("1. No new envvars: current behavior remains unchanged", async () => {
    expect(parseDefaultWorkspaceConfig({})).toEqual({ enabled: false });
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    const logger = silentLogger();
    const result = await bootstrapDefaultWorkspace({
      env: {},
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger,
    });
    expect(result).toMatchObject({ bootstrapped: false });
    expect(model._store).toHaveLength(0);
    expect(logger.log).not.toHaveBeenCalled();
  });
});

describe("default workspace bootstrap: creation and idempotency", () => {
  it("2. Creation: creates configured workspace", async () => {
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    const result = await bootstrapDefaultWorkspace({
      env: envObject({
        [ENV_KEYS.NAME]: "Kepler",
        [ENV_KEYS.SLUG]: "kepler",
        [ENV_KEYS.CHAT_MODE]: "chat",
        [ENV_KEYS.TEMPERATURE]: "1",
        [ENV_KEYS.HISTORY]: "20",
      }),
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    expect(result.bootstrapped).toBe(true);
    expect(result.created).toBe(true);
    expect(model._store).toHaveLength(1);
    const stored = model._store[0];
    expect(stored.name).toBe("Kepler");
    expect(stored.slug).toBe("kepler");
    expect(stored.chatMode).toBe("chat");
    expect(stored.openAiTemp).toBe(1);
    expect(stored.openAiHistory).toBe(20);
  });

  it("3. Idempotency: second startup does not create another workspace", async () => {
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    const env = envObject({
      [ENV_KEYS.NAME]: "Kepler",
      [ENV_KEYS.SLUG]: "kepler",
    });
    const first = await bootstrapDefaultWorkspace({
      env,
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    const second = await bootstrapDefaultWorkspace({
      env,
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(model._store).toHaveLength(1);
    expect(second.workspace.slug).toBe("kepler");
  });

  it("4. Persistence: UI edits survive a simulated restart", async () => {
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    const env = envObject({
      [ENV_KEYS.NAME]: "Kepler",
      [ENV_KEYS.SLUG]: "kepler",
      [ENV_KEYS.PROMPT]: "Original prompt",
    });
    await bootstrapDefaultWorkspace({
      env,
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    await model.directUpdate("kepler", {
      openAiPrompt: "Edited in UI",
      chatMode: "query",
    });
    const restart = await bootstrapDefaultWorkspace({
      env,
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    expect(restart.created).toBe(false);
    expect(model._store).toHaveLength(1);
    expect(model._store[0].openAiPrompt).toBe("Edited in UI");
    expect(model._store[0].chatMode).toBe("query");
  });

  it("handles concurrent initialization without duplicates", async () => {
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    const env = envObject({
      [ENV_KEYS.NAME]: "Kepler",
      [ENV_KEYS.SLUG]: "kepler",
    });
    const logger = silentLogger();
    const [first, second] = await Promise.all([
      bootstrapDefaultWorkspace({
        env,
        WorkspaceModel: model,
        getSystemDefaultPrompt,
        logger,
      }),
      bootstrapDefaultWorkspace({
        env,
        WorkspaceModel: model,
        getSystemDefaultPrompt,
        logger,
      }),
    ]);
    expect(model._store).toHaveLength(1);
    expect([first.bootstrapped, second.bootstrapped]).toEqual([true, true]);
  });
});

describe("default workspace bootstrap: system prompt sources", () => {
  it("5. Plain system prompt: stored exactly", async () => {
    const prompt = "  You are Kepler AI.\nKeep  spacing\tand\nnewlines.  ";
    const parsed = parseDefaultWorkspaceConfig(
      envObject({
        [ENV_KEYS.NAME]: "Kepler",
        [ENV_KEYS.PROMPT]: prompt,
      })
    );
    expect(parsed.openAiPrompt).toBe(prompt);
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    await bootstrapDefaultWorkspace({
      env: envObject({
        [ENV_KEYS.NAME]: "Kepler",
        [ENV_KEYS.SLUG]: "kepler",
        [ENV_KEYS.PROMPT]: prompt,
      }),
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    expect(model._store[0].openAiPrompt).toBe(prompt);
  });

  it("6. Base64 system prompt: decoded and stored exactly", async () => {
    const prompt = "You are Kepler AI...";
    const encoded = Buffer.from(prompt, "utf8").toString("base64");
    const parsed = parseDefaultWorkspaceConfig(
      envObject({
        [ENV_KEYS.NAME]: "Kepler",
        [ENV_KEYS.PROMPT_BASE64]: encoded,
      })
    );
    expect(parsed.openAiPrompt).toBe(prompt);
    expect(parsed.systemPromptSource).toBe("base64");
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    await bootstrapDefaultWorkspace({
      env: envObject({
        [ENV_KEYS.NAME]: "Kepler",
        [ENV_KEYS.PROMPT_BASE64]: encoded,
      }),
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    expect(model._store[0].openAiPrompt).toBe(prompt);
  });

  it("7. Multiline Base64 system prompt: newlines and whitespace preserved", async () => {
    const prompt = "Line one\n  Line two\twith tab\n\nLine four  \n";
    const encoded = Buffer.from(prompt, "utf8").toString("base64");
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    await bootstrapDefaultWorkspace({
      env: envObject({
        [ENV_KEYS.NAME]: "Kepler",
        [ENV_KEYS.PROMPT_BASE64]: encoded,
      }),
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    expect(model._store[0].openAiPrompt).toBe(prompt);
  });

  it("8. Invalid Base64: actionable failure without plain fallback", () => {
    expect(() =>
      parseDefaultWorkspaceConfig(
        envObject({
          [ENV_KEYS.NAME]: "Kepler",
          [ENV_KEYS.PROMPT]: "plain should not win",
          [ENV_KEYS.PROMPT_BASE64]: "!!!not-base64!!!",
        })
      )
    ).toThrow(/BASE64.*malformed/i);
  });

  it("9. Invalid UTF-8: actionable failure", () => {
    const invalidBytes = Buffer.from([0xff, 0xfe, 0xfd]);
    const encoded = invalidBytes.toString("base64");
    expect(() =>
      parseDefaultWorkspaceConfig(
        envObject({
          [ENV_KEYS.NAME]: "Kepler",
          [ENV_KEYS.PROMPT_BASE64]: encoded,
        })
      )
    ).toThrow(/UTF-8/i);
  });

  it("10. File prompt: reads and stores exact contents", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keplerllm-prompt-"));
    try {
      const filePath = path.join(dir, "prompt.txt");
      const contents = "File prompt\n  verbatim\twith\n\nnewlines  ";
      fs.writeFileSync(filePath, contents, "utf8");
      const parsed = parseDefaultWorkspaceConfig(
        envObject({
          [ENV_KEYS.NAME]: "Kepler",
          [ENV_KEYS.PROMPT_FILE]: filePath,
        })
      );
      expect(parsed.openAiPrompt).toBe(contents);
      const { model, getSystemDefaultPrompt } = createFakeWorkspace();
      await bootstrapDefaultWorkspace({
        env: envObject({
          [ENV_KEYS.NAME]: "Kepler",
          [ENV_KEYS.SLUG]: "kepler",
          [ENV_KEYS.PROMPT_FILE]: filePath,
        }),
        WorkspaceModel: model,
        getSystemDefaultPrompt,
        logger: silentLogger(),
      });
      expect(model._store[0].openAiPrompt).toBe(contents);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("11. Missing prompt file: actionable failure", () => {
    expect(() =>
      parseDefaultWorkspaceConfig(
        envObject({
          [ENV_KEYS.NAME]: "Kepler",
          [ENV_KEYS.PROMPT_FILE]: "/definitely/missing/prompt.txt",
        })
      )
    ).toThrow(/does not exist/i);
  });

  it("12. Source precedence: FILE > BASE64 > plain", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keplerllm-prec-"));
    try {
      const filePath = path.join(dir, "prompt.txt");
      fs.writeFileSync(filePath, "from-file", "utf8");
      const fromBase64 = Buffer.from("from-base64", "utf8").toString("base64");

      const fileWins = parseDefaultWorkspaceConfig(
        envObject({
          [ENV_KEYS.NAME]: "Kepler",
          [ENV_KEYS.PROMPT]: "from-plain",
          [ENV_KEYS.PROMPT_BASE64]: fromBase64,
          [ENV_KEYS.PROMPT_FILE]: filePath,
        })
      );
      expect(fileWins.openAiPrompt).toBe("from-file");
      expect(fileWins.systemPromptSource).toBe("file");

      const base64Wins = parseDefaultWorkspaceConfig(
        envObject({
          [ENV_KEYS.NAME]: "Kepler",
          [ENV_KEYS.PROMPT]: "from-plain",
          [ENV_KEYS.PROMPT_BASE64]: fromBase64,
        })
      );
      expect(base64Wins.openAiPrompt).toBe("from-base64");
      expect(base64Wins.systemPromptSource).toBe("base64");

      const plainWins = parseDefaultWorkspaceConfig(
        envObject({
          [ENV_KEYS.NAME]: "Kepler",
          [ENV_KEYS.PROMPT]: "from-plain",
        })
      );
      expect(plainWins.openAiPrompt).toBe("from-plain");
      expect(plainWins.systemPromptSource).toBe("plain");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never logs full prompt or Base64 payloads", async () => {
    const prompt = "Super secret system prompt contents";
    const encoded = Buffer.from(prompt, "utf8").toString("base64");
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    const logger = silentLogger();
    await bootstrapDefaultWorkspace({
      env: envObject({
        [ENV_KEYS.NAME]: "Kepler",
        [ENV_KEYS.SLUG]: "kepler",
        [ENV_KEYS.PROMPT_BASE64]: encoded,
      }),
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger,
    });
    const logged = logger.log.mock.calls
      .map((args) => args.join(" "))
      .join("\n");
    expect(logged).not.toContain(prompt);
    expect(logged).not.toContain(encoded);
    expect(logged).toMatch(/systemPromptSource=base64/);
  });
});

describe("default workspace bootstrap: numeric and partial configuration", () => {
  it("13. Temperature parsing", () => {
    expect(
      parseDefaultWorkspaceConfig(
        envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.TEMPERATURE]: "1" })
      ).openAiTemp
    ).toBe(1);
    expect(
      parseDefaultWorkspaceConfig(
        envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.TEMPERATURE]: "0.7" })
      ).openAiTemp
    ).toBe(0.7);
    expect(
      parseDefaultWorkspaceConfig(
        envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.TEMPERATURE]: "0" })
      ).openAiTemp
    ).toBe(0);
  });

  it("14. History parsing", () => {
    expect(
      parseDefaultWorkspaceConfig(
        envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.HISTORY]: "20" })
      ).openAiHistory
    ).toBe(20);
    expect(
      parseDefaultWorkspaceConfig(
        envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.HISTORY]: "0" })
      ).openAiHistory
    ).toBe(0);
  });

  it("15. Invalid numeric values fail instead of coercing", () => {
    expect(() =>
      parseDefaultWorkspaceConfig(
        envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.TEMPERATURE]: "foo" })
      )
    ).toThrow(/TEMPERATURE/i);
    expect(() =>
      parseDefaultWorkspaceConfig(
        envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.HISTORY]: "abc" })
      )
    ).toThrow(/HISTORY/i);
    expect(() =>
      parseDefaultWorkspaceConfig(
        envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.TEMPERATURE]: "" })
      )
    ).toThrow(/TEMPERATURE/i);
  });

  it("rejects invalid chat modes", () => {
    expect(() =>
      parseDefaultWorkspaceConfig(
        envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.CHAT_MODE]: "nope" })
      )
    ).toThrow(/CHAT_MODE/i);
  });

  it("16. Partial configuration: NAME+SLUG without prompt is valid", async () => {
    const parsed = parseDefaultWorkspaceConfig(
      envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.SLUG]: "kepler" })
    );
    expect(parsed.enabled).toBe(true);
    expect(parsed.openAiPrompt).toBeUndefined();
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    const result = await bootstrapDefaultWorkspace({
      env: envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.SLUG]: "kepler" }),
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    expect(result.created).toBe(true);
    // Unset prompt falls back to the model default, never to empty.
    expect(model._store[0].openAiPrompt).toBe(Workspace.defaultPrompt);
  });

  it("16b. Partial configuration: NAME+BASE64 without slug uses generation", async () => {
    const prompt = "Generated slug prompt";
    const encoded = Buffer.from(prompt, "utf8").toString("base64");
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    const result = await bootstrapDefaultWorkspace({
      env: envObject({
        [ENV_KEYS.NAME]: "Kepler",
        [ENV_KEYS.PROMPT_BASE64]: encoded,
      }),
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    expect(result.created).toBe(true);
    expect(model._store).toHaveLength(1);
    expect(model._store[0].openAiPrompt).toBe(prompt);
    expect(model._store[0].slug).toBe(
      Workspace.slugify("Kepler", { lower: true })
    );
  });

  it("16c. Unset variables leave upstream defaults intact", async () => {
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    await bootstrapDefaultWorkspace({
      env: envObject({ [ENV_KEYS.NAME]: "Kepler", [ENV_KEYS.SLUG]: "kepler" }),
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    const stored = model._store[0];
    expect(stored.chatMode).toBe("automatic");
    expect(stored.openAiHistory).toBe(20);
    expect(stored.openAiTemp).toBeNull();
  });
});

describe("default workspace bootstrap: backend compatibility", () => {
  it("17. SQLite compatibility: uses only the Workspace model layer", async () => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "utils",
        "boot",
        "defaultWorkspace.js"
      ),
      "utf8"
    );
    const codeWithoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(codeWithoutComments.toLowerCase()).not.toMatch(/sqlite/);
    expect(codeWithoutComments.toLowerCase()).not.toMatch(/postgres/);
    expect(codeWithoutComments).not.toMatch(/prisma\.(workspaces|\$)/);
    expect(codeWithoutComments).not.toMatch(/DATABASE_URL/);

    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    const result = await bootstrapDefaultWorkspace({
      env: envObject({
        [ENV_KEYS.NAME]: "Kepler",
        [ENV_KEYS.SLUG]: "kepler",
        [ENV_KEYS.PROMPT]: "sqlite path",
      }),
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    expect(result.created).toBe(true);
    expect(model._store[0].slug).toBe("kepler");
  });

  it("18. PostgreSQL compatibility: same model-layer path works", async () => {
    const { model, getSystemDefaultPrompt } = createFakeWorkspace();
    const env = envObject({
      [ENV_KEYS.NAME]: "Kepler",
      [ENV_KEYS.SLUG]: "kepler",
      [ENV_KEYS.PROMPT]: "postgres path",
      [ENV_KEYS.CHAT_MODE]: "chat",
      [ENV_KEYS.TEMPERATURE]: "1",
      [ENV_KEYS.HISTORY]: "20",
    });
    const first = await bootstrapDefaultWorkspace({
      env,
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    const second = await bootstrapDefaultWorkspace({
      env,
      WorkspaceModel: model,
      getSystemDefaultPrompt,
      logger: silentLogger(),
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(model._store).toHaveLength(1);
    expect(model._store[0].openAiPrompt).toBe("postgres path");
  });
});
