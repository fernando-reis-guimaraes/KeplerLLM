const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// KeplerLLM fork: live SQLite integration coverage for the default workspace
// bootstrap. Exercises the real path:
//
//   bootstrapDefaultWorkspace -> Workspace model -> Prisma -> SQLite
//
// No mocks. Skipped when DATABASE_URL is set so the suite never touches a
// PostgreSQL/external backend. PostgreSQL remains covered structurally by the
// provider-independent unit tests plus the Prisma schema-parity check.

const serverDir = path.join(__dirname, "..", "..", "..");
const dbPath = path.join(serverDir, "storage", "anythingllm.db");

const shouldRunLive = !process.env.DATABASE_URL;
const describeLive = shouldRunLive ? describe : describe.skip;

describeLive("default workspace bootstrap: live SQLite integration", () => {
  const { Workspace } = require("../../../models/workspace");
  const {
    ENV_KEYS,
    bootstrapDefaultWorkspace,
  } = require("../../../utils/boot/defaultWorkspace");

  const runId = `${Date.now().toString(36)}${process.pid.toString(36)}`;
  const slug = `qb-sqlite-${runId}`.toLowerCase();
  const name = `QB SQLite ${runId}`;
  const createdSlugs = [];
  let dbPreExisted = fs.existsSync(dbPath);

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

  const logger = { log: jest.fn(), error: jest.fn() };

  beforeAll(() => {
    // Self-sufficient locally, no-op in CI where prisma:setup already ran.
    execFileSync(
      path.join(serverDir, "node_modules", ".bin", "prisma"),
      ["migrate", "deploy"],
      { cwd: serverDir, stdio: "pipe" }
    );
    dbPreExisted = dbPreExisted || fs.existsSync(dbPath);
  }, 120000);

  afterAll(async () => {
    const prisma = require("../../../utils/prisma");
    try {
      for (const tracked of createdSlugs) {
        try {
          await prisma.workspaces.deleteMany({ where: { slug: tracked } });
        } catch {
          // Already removed; cleanup must not fail the suite.
        }
      }
    } finally {
      await prisma.$disconnect().catch(() => {});
      // Leave the tree as found: only remove the database file when this
      // suite created it.
      if (!dbPreExisted && fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { force: true });
        for (const suffix of ["-journal", "-wal", "-shm"]) {
          fs.rmSync(`${dbPath}${suffix}`, { force: true });
        }
      }
    }
  });

  it("creates the configured workspace with persisted prompt and settings", async () => {
    const result = await bootstrapDefaultWorkspace({ env: env(), logger });

    expect(result.bootstrapped).toBe(true);
    expect(result.created).toBe(true);
    createdSlugs.push(slug);

    const stored = await Workspace.get({ slug });
    expect(stored).not.toBeNull();
    expect(stored.name).toBe(name);
    expect(stored.openAiPrompt).toBe(
      "sqlite-integration-prompt\n  verbatim  "
    );
    expect(stored.chatMode).toBe("chat");
    expect(stored.openAiTemp).toBe(0.5);
    expect(stored.openAiHistory).toBe(7);
  });

  it("second bootstrap creates no duplicate", async () => {
    const before = await Workspace.where({ slug });
    const restart = await bootstrapDefaultWorkspace({ env: env(), logger });

    expect(restart.bootstrapped).toBe(true);
    expect(restart.created).toBe(false);
    const after = await Workspace.where({ slug });
    expect(after.length).toBe(before.length);
    expect(after.length).toBe(1);
  });

  it("edits made through the model layer are not overwritten", async () => {
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
});
