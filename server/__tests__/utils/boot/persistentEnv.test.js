const fs = require("fs");
const os = require("os");
const path = require("path");

const ensurePersistentEnv = require("../../../utils/boot/persistentEnv");

describe("ensurePersistentEnv (KeplerLLM persistent UI configuration)", () => {
  let tmpRoot;
  let savedStorageDir;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "keplerllm-env-"));
    savedStorageDir =
      "STORAGE_DIR" in process.env ? process.env.STORAGE_DIR : undefined;
    delete process.env.STORAGE_DIR;
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    if (savedStorageDir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = savedStorageDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function layout() {
    const serverDir = path.join(tmpRoot, "server");
    const storageDir = path.join(tmpRoot, "storage");
    fs.mkdirSync(serverDir, { recursive: true });
    return {
      serverDir,
      storageDir,
      runtimeEnvPath: path.join(serverDir, ".env"),
      persistentEnvPath: path.join(storageDir, ".env"),
    };
  }

  function readLinkTarget(linkPath) {
    return path.resolve(
      path.dirname(linkPath),
      fs.readlinkSync(linkPath)
    );
  }

  it("creates a missing storage directory and links the runtime file", () => {
    const { storageDir, runtimeEnvPath, persistentEnvPath } = layout();

    const result = ensurePersistentEnv({ storageDir, runtimeEnvPath });

    expect(fs.statSync(storageDir).isDirectory()).toBe(true);
    expect(fs.lstatSync(runtimeEnvPath).isSymbolicLink()).toBe(true);
    expect(readLinkTarget(runtimeEnvPath)).toBe(persistentEnvPath);
    expect(result).toMatchObject({
      storageDir,
      runtimeEnvPath,
      persistentEnvPath,
      seeded: true,
    });
  });

  it("seeds the persistent file once from the shipped default", () => {
    const { storageDir, runtimeEnvPath, persistentEnvPath } = layout();
    fs.writeFileSync(runtimeEnvPath, "LLM_PROVIDER=openai\n", "utf8");

    ensurePersistentEnv({ storageDir, runtimeEnvPath });

    expect(fs.readFileSync(persistentEnvPath, "utf8")).toBe(
      "LLM_PROVIDER=openai\n"
    );
    expect(fs.readFileSync(runtimeEnvPath, "utf8")).toBe(
      "LLM_PROVIDER=openai\n"
    );
  });

  it("never overwrites an existing persistent file (seed-once)", () => {
    const { storageDir, runtimeEnvPath, persistentEnvPath } = layout();
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(persistentEnvPath, "USER_EDITED=true\n", "utf8");
    fs.writeFileSync(runtimeEnvPath, "IMAGE_DEFAULT=true\n", "utf8");

    const result = ensurePersistentEnv({ storageDir, runtimeEnvPath });

    expect(result.seeded).toBe(false);
    expect(fs.readFileSync(persistentEnvPath, "utf8")).toBe(
      "USER_EDITED=true\n"
    );
    expect(readLinkTarget(runtimeEnvPath)).toBe(persistentEnvPath);
  });

  it("creates an empty persistent file when no shipped default exists", () => {
    const { storageDir, runtimeEnvPath, persistentEnvPath } = layout();

    ensurePersistentEnv({ storageDir, runtimeEnvPath });

    expect(fs.readFileSync(persistentEnvPath, "utf8")).toBe("");
  });

  it("is idempotent across restarts", () => {
    const { storageDir, runtimeEnvPath, persistentEnvPath } = layout();
    fs.writeFileSync(runtimeEnvPath, "LLM_PROVIDER=openai\n", "utf8");

    ensurePersistentEnv({ storageDir, runtimeEnvPath });
    const second = ensurePersistentEnv({ storageDir, runtimeEnvPath });

    expect(second.seeded).toBe(false);
    expect(second.alreadyLinked).toBe(true);
    expect(fs.readFileSync(persistentEnvPath, "utf8")).toBe(
      "LLM_PROVIDER=openai\n"
    );
    expect(readLinkTarget(runtimeEnvPath)).toBe(persistentEnvPath);
  });

  it("fails fast with a clear error when the persistent file is not writable", () => {
    const { storageDir, runtimeEnvPath, persistentEnvPath } = layout();
    fs.writeFileSync(runtimeEnvPath, "LLM_PROVIDER=openai\n", "utf8");
    jest.spyOn(fs, "accessSync").mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(() =>
      ensurePersistentEnv({ storageDir, runtimeEnvPath })
    ).toThrow(/not writable/);
    expect(() =>
      ensurePersistentEnv({ storageDir, runtimeEnvPath })
    ).toThrow(persistentEnvPath);
    // The runtime default is left untouched when persistence cannot proceed.
    expect(fs.lstatSync(runtimeEnvPath).isFile()).toBe(true);
  });

  it("leaves the runtime file alone when it already is the persistent file", () => {
    const { storageDir } = layout();
    const runtimeEnvPath = path.join(storageDir, ".env");
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(runtimeEnvPath, "LLM_PROVIDER=openai\n", "utf8");

    const result = ensurePersistentEnv({ storageDir, runtimeEnvPath });

    expect(fs.lstatSync(runtimeEnvPath).isFile()).toBe(true);
    expect(fs.readFileSync(runtimeEnvPath, "utf8")).toBe(
      "LLM_PROVIDER=openai\n"
    );
    expect(result.seeded).toBe(false);
  });
});
