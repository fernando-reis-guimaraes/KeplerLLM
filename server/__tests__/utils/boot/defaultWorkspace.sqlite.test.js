const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// KeplerLLM fork: live SQLite integration coverage for the default workspace
// bootstrap. Exercises the real path:
//
//   bootstrapDefaultWorkspace -> Workspace model -> Prisma -> SQLite
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
// real PrismaClient, only pointed elsewhere. Skipped when DATABASE_URL is set
// so the suite never touches a PostgreSQL/external backend. PostgreSQL
// remains covered structurally by the provider-independent unit tests plus
// the Prisma schema-parity check.

const serverDir = path.join(__dirname, "..", "..", "..");
const prodDbPath = path.join(serverDir, "storage", "anythingllm.db");

// Unique temp database for this run. Created synchronously at module top so
// the jest.mock factory below (hoisted, runs on first require) can read it.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "keplerllm-ws-boot-"));
const testDbPath = path.join(tmpDir, "bootstrap-test.db");
process.env.KEPLERLLM_TEST_SQLITE_URL = `file:${testDbPath}`;

// Redirect the entire model layer (`Workspace`, `SystemSettings`, ...) to a
// REAL PrismaClient bound to the temp database. No Prisma call is stubbed.
jest.mock("../../../utils/prisma", () => {
  const {
    PrismaClient,
  } = require("../../../node_modules/.prisma/client");
  return new PrismaClient({
    datasourceUrl: process.env.KEPLERLLM_TEST_SQLITE_URL,
    log: [],
  });
});

const shouldRunLive = !process.env.DATABASE_URL;
const describeLive = shouldRunLive ? describe : describe.skip;

if (!shouldRunLive) {
  // Skipped: leave no temp directory behind.
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KEPLERLLM_TEST_SQLITE_URL;
}

describeLive("default workspace bootstrap: live SQLite integration", () => {
  const { Workspace } = require("../../../models/workspace");
  const {
    ENV_KEYS,
    bootstrapDefaultWorkspace,
  } = require("../../../utils/boot/defaultWorkspace");
  // Same mocked instance the models use: direct reads here prove the models
  // persisted to the temp database.
  const testPrisma = require("../../../utils/prisma");

  const runId = `${Date.now().toString(36)}${process.pid.toString(36)}`;
  const slug = `qb-sqlite-${runId}`.toLowerCase();
  const name = `QB SQLite ${runId}`;
  const logger = { log: jest.fn(), error: jest.fn() };

  // Pre-state of the production database for the untouched-guard below.
  const prodPreState = fs.existsSync(prodDbPath)
    ? { exists: true, size: fs.statSync(prodDbPath).size }
    : { exists: false, size: null };

  function env(extra = {}) {
    return {
      [ENV_KEYS.NAME]: name,
      [ENV_KEYS.SLUG]: slug,
      [ENV_KEYS.PROMPT]: "sqlite-integration-prompt\n  verbatim  ",
      [ENV_KEYS.CHAT_MODE]: "chat",
      [ENV_KEYS.TEMPERATURE]: "0.5",
      [ENV_KEYS.HISTORY]: "7",
      ...extra,
    };
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

  it("targets the isolated temp database, never the production path", async () => {
    expect(testDbPath.startsWith(os.tmpdir())).toBe(true);
    expect(testDbPath).not.toBe(prodDbPath);
    expect(fs.existsSync(testDbPath)).toBe(true);
    // The model layer shares the temp database: a row written through the
    // raw temp client is visible through the Workspace model and vice versa.
    await testPrisma.workspaces.create({
      data: { name, slug: `${slug}-probe`, chatMode: "chat" },
    });
    try {
      const viaModel = await Workspace.get({ slug: `${slug}-probe` });
      expect(viaModel).not.toBeNull();
      expect(viaModel.name).toBe(name);
    } finally {
      await testPrisma.workspaces.deleteMany({
        where: { slug: `${slug}-probe` },
      });
    }
  });

  it("1. bootstrap creates the workspace with persisted settings", async () => {
    const result = await bootstrapDefaultWorkspace({ env: env(), logger });

    expect(result.bootstrapped).toBe(true);
    expect(result.created).toBe(true);

    const stored = await Workspace.get({ slug });
    expect(stored).not.toBeNull();
    expect(stored.name).toBe(name);
    // 2. prompt/chatMode/temp/history persist exactly.
    expect(stored.openAiPrompt).toBe(
      "sqlite-integration-prompt\n  verbatim  "
    );
    expect(stored.chatMode).toBe("chat");
    expect(stored.openAiTemp).toBe(0.5);
    expect(stored.openAiHistory).toBe(7);

    // Same row through the raw temp client: proof of the real path.
    const raw = await testPrisma.workspaces.findUnique({ where: { slug } });
    expect(raw).not.toBeNull();
    expect(raw.openAiPrompt).toBe("sqlite-integration-prompt\n  verbatim  ");
  });

  it("3. second bootstrap creates no duplicate", async () => {
    const before = await testPrisma.workspaces.count({ where: { slug } });
    const restart = await bootstrapDefaultWorkspace({ env: env(), logger });

    expect(restart.bootstrapped).toBe(true);
    expect(restart.created).toBe(false);
    const after = await testPrisma.workspaces.count({ where: { slug } });
    expect(before).toBe(1);
    expect(after).toBe(1);
  });

  it("4. edits made through the model layer are not overwritten", async () => {
    const current = await Workspace.get({ slug });
    await Workspace.update(current.id, {
      openAiPrompt: "edited through the model layer",
      chatMode: "query",
    });

    const restart = await bootstrapDefaultWorkspace({ env: env(), logger });

    expect(restart.created).toBe(false);
    const stored = await Workspace.get({ slug });
    expect(stored.openAiPrompt).toBe("edited through the model layer");
    expect(stored.chatMode).toBe("query");
    // Untouched settings keep their bootstrapped values.
    expect(stored.openAiTemp).toBe(0.5);
    expect(stored.openAiHistory).toBe(7);
  });

  it("5. production database untouched and no test DB files left", async () => {
    // All test rows removed through the temp client.
    await testPrisma.workspaces.deleteMany({
      where: { slug: { startsWith: "qb-sqlite-" } },
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
