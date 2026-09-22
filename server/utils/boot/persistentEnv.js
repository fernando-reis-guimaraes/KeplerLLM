const fs = require("fs");
const path = require("path");

// KeplerLLM fork: UI-managed server configuration must survive restarts and
// redeploys using only the standard storage volume. The server reads its
// configuration from the runtime `.env` file (loaded by dotenv) and the
// settings UI writes back to that same file, so this boot step links the
// runtime file to `${STORAGE_DIR}/.env` before dotenv loads.
//
// Observable behavior:
// - The storage directory is created when missing.
// - On first boot the persistent file is seeded once from the default
//   configuration shipped in the image. An existing persistent file is
//   never overwritten.
// - Startup fails fast with a clear error when the persistent file is
//   not writable.
// - Restarts are idempotent: an already correct link is left untouched.

function defaultStorageDir() {
  return path.resolve(
    process.env.STORAGE_DIR ?? path.resolve(__dirname, "..", "..", "storage")
  );
}

function defaultRuntimeEnvPath() {
  // Matches the path dotenv resolves by default for the `.env` file.
  return path.resolve(process.cwd(), ".env");
}

function isRegularFile(filePath) {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isLinkTo(filePath, targetPath) {
  try {
    if (!fs.lstatSync(filePath).isSymbolicLink()) return false;
    return (
      path.resolve(path.dirname(filePath), fs.readlinkSync(filePath)) ===
      targetPath
    );
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function ensurePersistentEnv({ storageDir, runtimeEnvPath } = {}) {
  const storage = path.resolve(storageDir ?? defaultStorageDir());
  const runtime = path.resolve(runtimeEnvPath ?? defaultRuntimeEnvPath());
  const persistent = path.join(storage, ".env");

  fs.mkdirSync(storage, { recursive: true });

  let seeded = false;
  if (!fs.existsSync(persistent)) {
    if (isRegularFile(runtime)) {
      fs.copyFileSync(runtime, persistent);
    } else {
      fs.writeFileSync(persistent, "", { encoding: "utf8" });
    }
    seeded = true;
    console.log(
      `[KeplerLLM] Persistent UI configuration seeded at ${persistent}`
    );
  }

  try {
    fs.accessSync(persistent, fs.constants.W_OK);
  } catch {
    throw new Error(
      `[KeplerLLM] Persistent UI configuration at ${persistent} is not writable. ` +
        `Mount the storage volume read-write and restart.`
    );
  }

  const result = {
    storageDir: storage,
    runtimeEnvPath: runtime,
    persistentEnvPath: persistent,
    seeded,
  };

  // The storage directory itself holds the runtime file (for example when
  // STORAGE_DIR points at the server directory). There is nothing to link.
  if (runtime === persistent) return result;

  // Already linked from a previous boot. Leave it untouched.
  if (isLinkTo(runtime, persistent)) return { ...result, alreadyLinked: true };

  // Point the runtime file at the persistent configuration. The previous
  // file is replaced only after the persistent copy exists and is writable.
  // rmSync without `recursive` refuses to delete directories loudly instead
  // of destroying them.
  fs.rmSync(runtime, { force: true });
  fs.symlinkSync(persistent, runtime);

  return result;
}

module.exports = ensurePersistentEnv;
