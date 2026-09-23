const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// KeplerLLM fork: live SQLite integration coverage for the default agent
// skills bootstrap. Exercises the real path:
//
//   bootstrapDefaultAgentSkills -> SystemSettings model -> Prisma -> SQLite
//
// Isolation: this suite MUST NOT migrate, write to, or otherwise touch the
// developer's real database at `server/storage/anythingllm.db`. The
// production schema hardcodes `url = "file:../storage/anythingllm.db"` (so
// DATABASE_URL cannot redirect it), therefore this suite derives a temporary
// test schema from the production SQLite schema with ONLY the datasource URL
// rewritten to a unique temp-dir database, applies it with `db push`, and
// redirects the whole model layer to a real PrismaClient pointed at that
// temp database via the `datasourceUrl` constructor option (supported by the
// installed Prisma 5.3.1 generated client). The production datasource
// contract, migrations, and generated client are unchanged.
//
// No mocks of the persistence path: the mocked `utils/prisma` module IS a
// real PrismaClient, only pointed elsewhere. The suite is structurally
// excluded when DATABASE_URL is set so a PostgreSQL-configured test process
// never initializes any SQLite test state. PostgreSQL remains covered
// structurally by the provider-independent unit tests plus the Prisma
// schema-parity check.

const serverDir = path.join(__dirname, "..", "..", "..");
const prodDbPath = path.join(serverDir, "storage", "anythingllm.db");

const shouldRunLive = !process.env.DATABASE_URL;

// Unique temp database for this run. Created ONLY when the suite will run,
// synchronously at module top so the jest.mock factory below can read it.
let tmpDir = null;
let testDbPath = null;
if (shouldRunLive) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "keplerllm-skills-boot-"));
  testDbPath = path.join(tmpDir, "bootstrap-test.db");
  process.env.KEPLERLLM_TEST_SKILLS_SQLITE_URL = `file:${testDbPath}`;
}

// Redirect the entire model layer (`SystemSettings`, ...) to a REAL
// PrismaClient bound to the temp database. No Prisma call is stubbed.
// NOTE on Jest semantics: this `jest.mock()` call is hoisted, but that only
// registers the mock — the factory runs lazily on the first require of the
// mocked module. Those requires live inside the `describe` callback in the
// `else` branch below, so when DATABASE_URL is set the factory never runs,
// no PrismaClient is constructed, and no SQLite state is initialized.
jest.mock("../../../utils/prisma", () => {
  const {
    PrismaClient,
  } = require("../../../node_modules/.prisma/client");
  return new PrismaClient({
    datasourceUrl: process.env.KEPLERLLM_TEST_SKILLS_SQLITE_URL,
    log: [],
  });
});

if (!shouldRunLive) {
  it("SQLite integration skipped while DATABASE_URL is set", () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    // No SQLite test initialization happened for this process.
    expect(process.env.KEPLERLLM_TEST_SKILLS_SQLITE_URL).toBeUndefined();
  });
} else {
  describe("default agent skills bootstrap: live SQLite integration", () => {
    const { SystemSettings } = require("../../../models/systemSettings");
    const {
      ENV_KEY,
      SETTING_LABEL,
      bootstrapDefaultAgentSkills,
    } = require("../../../utils/boot/defaultAgentSkills");
    // Same mocked instance the models use: direct reads here prove the models
    // persisted to the temp database.
    const testPrisma = require("../../../utils/prisma");

    const logger = { log: jest.fn(), error: jest.fn() };

    // Pre-state of the production database for the untouched-guard below.
    const prodPreState = fs.existsSync(prodDbPath)
      ? { exists: true, size: fs.statSync(prodDbPath).size }
      : { exists: false, size: null };

    function env(value) {
      return { [ENV_KEY]: value };
    }

    async function storedSkills() {
      const row = await SystemSettings.get({ label: SETTING_LABEL });
      return row ? JSON.parse(row.value) : null;
    }

    function prodPostState() {
      return fs.existsSync(prodDbPath)
        ? { exists: true, size: fs.statSync(prodDbPath).size }
        : { exists: false, size: null };
    }

    beforeAll(() => {
      // Derive the temp schema: production schema with ONLY the URL changed.
      const prodSchema = fs.readFileSync(
        path.join(serverDir, "prisma", "schema.prisma"),
        "utf8"
      );
      if (!prodSchema.includes("file:../storage/anythingllm.db")) {
        throw new Error(
          "Production SQLite schema no longer uses the expected datasource URL; refusing to derive the isolated test schema."
        );
      }
      const testSchema = prodSchema.replace(
        "file:../storage/anythingllm.db",
        `file:${testDbPath}`
      );
      fs.writeFileSync(path.join(tmpDir, "schema.prisma"), testSchema, "utf8");
      // `db push` needs no migrations directory and leaves the production
      // database and migration history alone.
      execFileSync(
        path.join(serverDir, "node_modules", ".bin", "prisma"),
        [
          "db",
          "push",
          "--schema",
          path.join(tmpDir, "schema.prisma"),
          "--accept-data-loss",
          "--skip-generate",
        ],
        { cwd: serverDir, stdio: "pipe" }
      );
      if (!fs.existsSync(testDbPath)) {
        throw new Error("Isolated test database was not created.");
      }
    }, 120000);

    afterAll(async () => {
      await testPrisma.$disconnect().catch(() => {});
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      logger.log.mockClear();
      await testPrisma.system_settings.deleteMany({
        where: { label: SETTING_LABEL },
      });
    });

    it("targets the isolated temp database, never the production path", async () => {
      expect(testDbPath.startsWith(os.tmpdir())).toBe(true);
      expect(testDbPath).not.toBe(prodDbPath);
      expect(fs.existsSync(testDbPath)).toBe(true);
      // The model layer shares the temp database: a row written through the
      // raw temp client is visible through the SystemSettings model and vice versa.
      await testPrisma.system_settings.create({
        data: { label: SETTING_LABEL, value: JSON.stringify(["web-browsing"]) },
      });
      try {
        const viaModel = await SystemSettings.get({ label: SETTING_LABEL });
        expect(viaModel).not.toBeNull();
        expect(JSON.parse(viaModel.value)).toEqual(["web-browsing"]);
      } finally {
        await testPrisma.system_settings.deleteMany({
          where: { label: SETTING_LABEL },
        });
      }
    });

    it("1. bootstrap persists the parsed list through the real model path", async () => {
      const result = await bootstrapDefaultAgentSkills({
        env: env("filesystem-agent, create-files-agent,,web-browsing"),
        logger,
      });

      expect(result.bootstrapped).toBe(true);
      expect(result.created).toBe(true);

      const stored = await storedSkills();
      expect(stored).toEqual([
        "filesystem-agent",
        "create-files-agent",
        "web-browsing",
      ]);

      // Same row through the raw temp client: proof of the real path.
      const raw = await testPrisma.system_settings.findUnique({
        where: { label: SETTING_LABEL },
      });
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw.value)).toEqual([
        "filesystem-agent",
        "create-files-agent",
        "web-browsing",
      ]);
    });

    it("2. explicit empty string persists an empty list", async () => {
      const result = await bootstrapDefaultAgentSkills({
        env: env(""),
        logger,
      });
      expect(result.created).toBe(true);
      expect(await storedSkills()).toEqual([]);
    });

    it("3. invalid identifier fails before persistence", async () => {
      await expect(
        bootstrapDefaultAgentSkills({ env: env("web-browsing,nope"), logger })
      ).rejects.toThrow(/DEFAULT_AGENT_SKILLS.*nope/);
      expect(await storedSkills()).toBeNull();
      const raw = await testPrisma.system_settings.findUnique({
        where: { label: SETTING_LABEL },
      });
      expect(raw).toBeNull();
    });

    it("4. second bootstrap creates no duplicate and preserves UI edits", async () => {
      const bootEnv = env("filesystem-agent,web-browsing");
      const first = await bootstrapDefaultAgentSkills({
        env: bootEnv,
        logger,
      });
      expect(first.created).toBe(true);

      // Operator edits through the real model layer (as the UI/API would).
      await SystemSettings.updateSettings({
        [SETTING_LABEL]: "sql-agent",
      });
      expect(await storedSkills()).toEqual(["sql-agent"]);

      const restart = await bootstrapDefaultAgentSkills({
        env: bootEnv,
        logger,
      });
      expect(restart.bootstrapped).toBe(true);
      expect(restart.created).toBe(false);
      expect(await storedSkills()).toEqual(["sql-agent"]);

      const count = await testPrisma.system_settings.count({
        where: { label: SETTING_LABEL },
      });
      expect(count).toBe(1);
    });

    it("5. unset env creates no row", async () => {
      const result = await bootstrapDefaultAgentSkills({ env: {}, logger });
      expect(result.bootstrapped).toBe(false);
      expect(await storedSkills()).toBeNull();
    });

    it("6. production database untouched and no test DB files left", async () => {
      await testPrisma.system_settings.deleteMany({
        where: { label: SETTING_LABEL },
      });
      await testPrisma.$disconnect().catch(() => {});
      fs.rmSync(tmpDir, { recursive: true, force: true });

      expect(fs.existsSync(testDbPath)).toBe(false);
      expect(fs.existsSync(`${testDbPath}-journal`)).toBe(false);
      expect(fs.existsSync(`${testDbPath}-wal`)).toBe(false);
      expect(fs.existsSync(tmpDir)).toBe(false);
      // The developer database was never migrated, written, or created here.
      expect(prodPostState()).toEqual(prodPreState);
    });
  });
}
