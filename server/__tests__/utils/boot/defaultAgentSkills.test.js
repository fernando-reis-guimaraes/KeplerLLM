const fs = require("fs");
const path = require("path");

const {
  ENV_KEY,
  SETTING_LABEL,
  ACCEPTED_AGENT_SKILLS,
  isEnabled,
  parseDefaultAgentSkills,
  bootstrapDefaultAgentSkills,
} = require("../../../utils/boot/defaultAgentSkills");

// ---------------------------------------------------------------------------
// Env isolation: never leak the developer machine's real DEFAULT_AGENT_SKILLS
// value into tests.
// ---------------------------------------------------------------------------
let savedEnv;
function snapshotEnv() {
  savedEnv =
    ENV_KEY in process.env ? { [ENV_KEY]: process.env[ENV_KEY] } : {};
}
function clearEnv() {
  delete process.env[ENV_KEY];
}
function restoreEnv() {
  clearEnv();
  for (const [key, value] of Object.entries(savedEnv)) {
    process.env[key] = value;
  }
  savedEnv = undefined;
}

function envObject(overrides = {}) {
  return { ...overrides };
}

// In-memory SystemSettings model double. Mirrors the real model contract used
// by the bootstrap: get({ label }) returns the row or null, and
// updateSettings() applies the same comma-split validation the real
// SystemSettings.validations.default_agent_skills uses before storing the
// JSON array. Persistence goes only through get/updateSettings, mirroring the
// allowed model layer. No raw SQL and no provider-specific branches.
function createFakeSystemSettings() {
  const rows = new Map();
  let getCalls = 0;
  const updateCalls = [];

  return {
    rows,
    getCalls: () => getCalls,
    updateCalls,
    async get(clause = {}) {
      getCalls += 1;
      const label = clause.label;
      if (!label || !rows.has(label)) return null;
      return { label, value: rows.get(label) };
    },
    async updateSettings(updates = {}) {
      if (
        !Object.prototype.hasOwnProperty.call(updates, SETTING_LABEL) &&
        !Object.prototype.hasOwnProperty.call(updates, "default_agent_skills")
      ) {
        return { success: true, error: null };
      }
      const raw = updates[SETTING_LABEL];
      // Same shape as the real validation: split, drop empties, JSON array.
      let validated;
      try {
        const skills = raw.split(",").filter((skill) => !!skill);
        validated = JSON.stringify(skills);
      } catch {
        validated = JSON.stringify([]);
      }
      updateCalls.push({ input: raw, stored: validated });
      rows.set(SETTING_LABEL, validated);
      return { success: true, error: null };
    },
    // Simulates a UI/API edit that bypasses bootstrap (database is truth).
    async directUpdate(skillsArray) {
      rows.set(SETTING_LABEL, JSON.stringify(skillsArray));
    },
    storedSkills() {
      if (!rows.has(SETTING_LABEL)) return null;
      return JSON.parse(rows.get(SETTING_LABEL));
    },
  };
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

describe("default agent skills bootstrap: disabled behavior", () => {
  it("1. env var unset preserves upstream behavior: no row, no writes, no logs", async () => {
    expect(isEnabled({})).toBe(false);
    expect(parseDefaultAgentSkills({})).toEqual({ enabled: false });
    const model = createFakeSystemSettings();
    const logger = silentLogger();
    const result = await bootstrapDefaultAgentSkills({
      env: {},
      SystemSettingsModel: model,
      logger,
    });
    expect(result).toMatchObject({ bootstrapped: false });
    expect(model.getCalls()).toBe(0);
    expect(model.updateCalls).toHaveLength(0);
    expect(model.storedSkills()).toBeNull();
    expect(logger.log).not.toHaveBeenCalled();
  });
});

describe("default agent skills bootstrap: creation", () => {
  it("2. explicit empty string bootstraps an empty list (no opt-in skills)", async () => {
    expect(parseDefaultAgentSkills({ [ENV_KEY]: "" })).toEqual({
      enabled: true,
      skills: [],
    });
    const model = createFakeSystemSettings();
    const result = await bootstrapDefaultAgentSkills({
      env: envObject({ [ENV_KEY]: "" }),
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(result.bootstrapped).toBe(true);
    expect(result.created).toBe(true);
    expect(model.storedSkills()).toEqual([]);
  });

  it("3. one valid skill is persisted", async () => {
    const model = createFakeSystemSettings();
    const result = await bootstrapDefaultAgentSkills({
      env: envObject({ [ENV_KEY]: "web-browsing" }),
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(result.created).toBe(true);
    expect(model.storedSkills()).toEqual(["web-browsing"]);
  });

  it("4. all six valid skills are persisted", async () => {
    const model = createFakeSystemSettings();
    const all = ACCEPTED_AGENT_SKILLS.join(",");
    const result = await bootstrapDefaultAgentSkills({
      env: envObject({ [ENV_KEY]: all }),
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(result.created).toBe(true);
    expect(model.storedSkills()).toEqual(ACCEPTED_AGENT_SKILLS);
  });

  it("5. whitespace around values is trimmed", async () => {
    const model = createFakeSystemSettings();
    await bootstrapDefaultAgentSkills({
      env: envObject({
        [ENV_KEY]: "  filesystem-agent ,\tcreate-chart\n, web-browsing  ",
      }),
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(model.storedSkills()).toEqual([
      "filesystem-agent",
      "create-chart",
      "web-browsing",
    ]);
  });

  it("6. duplicate values are removed with deterministic ordering", async () => {
    const parsed = parseDefaultAgentSkills({
      [ENV_KEY]: "web-browsing,filesystem-agent,web-browsing,filesystem-agent",
    });
    expect(parsed).toEqual({
      enabled: true,
      skills: ["web-browsing", "filesystem-agent"],
    });
    const model = createFakeSystemSettings();
    await bootstrapDefaultAgentSkills({
      env: envObject({
        [ENV_KEY]:
          "web-browsing,filesystem-agent,web-browsing,filesystem-agent",
      }),
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(model.storedSkills()).toEqual([
      "web-browsing",
      "filesystem-agent",
    ]);
  });

  it("7. repeated separators and empty entries are removed", async () => {
    const parsed = parseDefaultAgentSkills({
      [ENV_KEY]: ",,filesystem-agent,,, ,create-chart,,",
    });
    expect(parsed).toEqual({
      enabled: true,
      skills: ["filesystem-agent", "create-chart"],
    });
    const model = createFakeSystemSettings();
    await bootstrapDefaultAgentSkills({
      env: envObject({ [ENV_KEY]: ",,filesystem-agent,,, ,create-chart,," }),
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(model.storedSkills()).toEqual(["filesystem-agent", "create-chart"]);
  });
});

describe("default agent skills bootstrap: validation failures", () => {
  it("8. unknown skill fails startup and persists nothing", async () => {
    expect(() =>
      parseDefaultAgentSkills({ [ENV_KEY]: "filesystem-agent,not-a-skill" })
    ).toThrow(/DEFAULT_AGENT_SKILLS.*not-a-skill/);
    const model = createFakeSystemSettings();
    await expect(
      bootstrapDefaultAgentSkills({
        env: envObject({ [ENV_KEY]: "filesystem-agent,not-a-skill" }),
        SystemSettingsModel: model,
        logger: silentLogger(),
      })
    ).rejects.toThrow(/DEFAULT_AGENT_SKILLS.*not-a-skill/);
    expect(model.updateCalls).toHaveLength(0);
    expect(model.storedSkills()).toBeNull();
  });

  it("9. error identifies the variable, the identifier, and accepted values", async () => {
    let error = null;
    try {
      parseDefaultAgentSkills({ [ENV_KEY]: "nope" });
    } catch (e) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/DEFAULT_AGENT_SKILLS/);
    expect(error.message).toMatch(/nope/);
    for (const skill of ACCEPTED_AGENT_SKILLS) {
      expect(error.message).toContain(skill);
    }
  });

  it("10. default-enabled skills are not accepted here (disabled_agent_skills is unchanged)", async () => {
    for (const skill of [
      "rag-memory",
      "document-summarizer",
      "web-scraping",
    ]) {
      expect(() => parseDefaultAgentSkills({ [ENV_KEY]: skill })).toThrow(
        /DEFAULT_AGENT_SKILLS/
      );
    }
  });

  it("11. app-integration and internal plugins are not accepted", async () => {
    for (const skill of [
      "gmail-agent",
      "google-calendar-agent",
      "outlook-agent",
      "request-user-input",
      "websocket",
      "memory",
    ]) {
      expect(() => parseDefaultAgentSkills({ [ENV_KEY]: skill })).toThrow(
        /DEFAULT_AGENT_SKILLS/
      );
    }
  });
});

describe("default agent skills bootstrap: existing setting is truth", () => {
  it("12. existing row is never overwritten even when env differs", async () => {
    const model = createFakeSystemSettings();
    await model.directUpdate(["web-browsing"]);
    const logger = silentLogger();
    const result = await bootstrapDefaultAgentSkills({
      env: envObject({ [ENV_KEY]: ACCEPTED_AGENT_SKILLS.join(",") }),
      SystemSettingsModel: model,
      logger,
    });
    expect(result.bootstrapped).toBe(true);
    expect(result.created).toBe(false);
    expect(model.storedSkills()).toEqual(["web-browsing"]);
    expect(model.updateCalls).toHaveLength(0);
    const logged = logger.log.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toMatch(/already exists|preserv/i);
  });

  it("13. UI/API changes after bootstrap survive a restart", async () => {
    const model = createFakeSystemSettings();
    const env = envObject({ [ENV_KEY]: "filesystem-agent,web-browsing" });
    const first = await bootstrapDefaultAgentSkills({
      env,
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(first.created).toBe(true);
    expect(model.storedSkills()).toEqual([
      "filesystem-agent",
      "web-browsing",
    ]);

    // Operator edits through the UI/API: database becomes source of truth.
    await model.directUpdate(["sql-agent"]);

    const restart = await bootstrapDefaultAgentSkills({
      env,
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(restart.created).toBe(false);
    expect(model.storedSkills()).toEqual(["sql-agent"]);
  });

  it("14. second boot is idempotent: exactly one persistence call", async () => {
    const model = createFakeSystemSettings();
    const env = envObject({ [ENV_KEY]: "create-chart" });
    const first = await bootstrapDefaultAgentSkills({
      env,
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    const second = await bootstrapDefaultAgentSkills({
      env,
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(model.updateCalls).toHaveLength(1);
    expect(model.storedSkills()).toEqual(["create-chart"]);
  });

  it("15. existing row wins over an invalid env value (bootstrap-only, never authoritative)", async () => {
    // Once initialized, the database is the source of truth and the
    // environment value is fully ignored, so a stale invalid value cannot
    // take down a configured instance. Typos still fail fast on the
    // creation path (see tests 8-9), where nothing is persisted yet.
    const model = createFakeSystemSettings();
    await model.directUpdate(["web-browsing"]);
    const result = await bootstrapDefaultAgentSkills({
      env: envObject({ [ENV_KEY]: "not-a-skill" }),
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(result.created).toBe(false);
    expect(model.storedSkills()).toEqual(["web-browsing"]);
  });
});

describe("default agent skills bootstrap: logging", () => {
  it("16. successful creation logs safe skill metadata without secrets", async () => {
    const model = createFakeSystemSettings();
    const logger = silentLogger();
    await bootstrapDefaultAgentSkills({
      env: envObject({ [ENV_KEY]: "filesystem-agent,web-browsing" }),
      SystemSettingsModel: model,
      logger,
    });
    const logged = logger.log.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toMatch(/filesystem-agent/);
    expect(logged).toMatch(/web-browsing/);
    expect(logged).toMatch(/count=2/);
  });
});

describe("default agent skills bootstrap: backend compatibility", () => {
  it("17. uses only the SystemSettings model layer", async () => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "utils",
        "boot",
        "defaultAgentSkills.js"
      ),
      "utf8"
    );
    const codeWithoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(codeWithoutComments.toLowerCase()).not.toMatch(/sqlite/);
    expect(codeWithoutComments.toLowerCase()).not.toMatch(/postgres/);
    expect(codeWithoutComments).not.toMatch(/prisma\.(system_settings|\$)/);
    expect(codeWithoutComments).not.toMatch(/DATABASE_URL/);

    const model = createFakeSystemSettings();
    const result = await bootstrapDefaultAgentSkills({
      env: envObject({ [ENV_KEY]: "sql-agent" }),
      SystemSettingsModel: model,
      logger: silentLogger(),
    });
    expect(result.created).toBe(true);
    expect(model.storedSkills()).toEqual(["sql-agent"]);
  });

  it("18. stored encoding matches the real SystemSettings validation path", async () => {
    const { SystemSettings } = require("../../../models/systemSettings");
    const cases = ["filesystem-agent", "filesystem-agent,web-browsing", ""];
    const model = createFakeSystemSettings();
    for (const input of cases) {
      const expected = SystemSettings.validations.default_agent_skills(input);
      await model.updateSettings({ [SETTING_LABEL]: input });
      expect(model.rows.get(SETTING_LABEL)).toBe(expected);
    }
  });
});

describe("default agent skills bootstrap: canonical skill list drift guard", () => {
  const EXPECTED = [
    "filesystem-agent",
    "create-files-agent",
    "create-chart",
    "web-browsing",
    "sql-agent",
    "create-scheduled-job",
  ];

  it("19. accepted identifiers are exactly the six opt-in configurable skills", () => {
    expect(ACCEPTED_AGENT_SKILLS).toEqual(EXPECTED);
  });

  it("20. canonical skills exist as server plugin files and UI configurable skills", () => {
    const serverDir = path.join(__dirname, "..", "..", "..");
    const pluginFileBySkill = {
      "filesystem-agent": "utils/agents/aibitat/plugins/filesystem/index.js",
      "create-files-agent": "utils/agents/aibitat/plugins/create-files/index.js",
      "create-chart": "utils/agents/aibitat/plugins/rechart.js",
      "web-browsing": "utils/agents/aibitat/plugins/web-browsing.js",
      "sql-agent": "utils/agents/aibitat/plugins/sql-agent/index.js",
      "create-scheduled-job":
        "utils/agents/aibitat/plugins/create-scheduled-job/index.js",
    };
    for (const skill of ACCEPTED_AGENT_SKILLS) {
      expect(fs.existsSync(path.join(serverDir, pluginFileBySkill[skill]))).toBe(
        true
      );
    }
    // The Agent Skills UI must keep offering these as configurable (opt-in)
    // skills. If upstream renames a skill or moves it between UI groups,
    // this test makes the drift visible so DEFAULT_AGENT_SKILLS validation
    // can be realigned in the same change.
    const skillsJsx = fs.readFileSync(
      path.join(
        serverDir,
        "..",
        "frontend",
        "src",
        "pages",
        "Admin",
        "Agents",
        "skills.jsx"
      ),
      "utf8"
    );
    const configurableStart = skillsJsx.indexOf("getConfigurableSkills");
    const appIntegrationStart = skillsJsx.indexOf("getAppIntegrationSkills");
    expect(configurableStart).toBeGreaterThanOrEqual(0);
    expect(appIntegrationStart).toBeGreaterThan(configurableStart);
    const configurableBlock = skillsJsx.slice(
      configurableStart,
      appIntegrationStart
    );
    for (const skill of ACCEPTED_AGENT_SKILLS) {
      expect(configurableBlock).toContain(`"${skill}"`);
    }
  });
});
