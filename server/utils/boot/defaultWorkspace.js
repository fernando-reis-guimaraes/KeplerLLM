const fs = require("fs");

// KeplerLLM fork: bootstrap the default AnythingLLM workspace from environment
// variables. Bootstrap-only semantics: environment values are used to create
// the workspace when it does not exist yet. The database remains the source
// of truth afterwards, so restarts never overwrite UI/API changes.
//
// Supported variables:
//   DEFAULT_WORKSPACE_NAME
//   DEFAULT_WORKSPACE_SLUG
//   DEFAULT_WORKSPACE_SYSTEM_PROMPT
//   DEFAULT_WORKSPACE_SYSTEM_PROMPT_BASE64
//   DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE
//   DEFAULT_WORKSPACE_CHAT_MODE
//   DEFAULT_WORKSPACE_TEMPERATURE
//   DEFAULT_WORKSPACE_HISTORY
//
// Precedence for the system prompt: FILE > BASE64 > plain.
// This module contains no SQLite/PostgreSQL-specific code and issues no raw
// SQL. All persistence goes through the existing Workspace model layer.

const ENV_KEYS = {
  NAME: "DEFAULT_WORKSPACE_NAME",
  SLUG: "DEFAULT_WORKSPACE_SLUG",
  PROMPT: "DEFAULT_WORKSPACE_SYSTEM_PROMPT",
  PROMPT_BASE64: "DEFAULT_WORKSPACE_SYSTEM_PROMPT_BASE64",
  PROMPT_FILE: "DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE",
  CHAT_MODE: "DEFAULT_WORKSPACE_CHAT_MODE",
  TEMPERATURE: "DEFAULT_WORKSPACE_TEMPERATURE",
  HISTORY: "DEFAULT_WORKSPACE_HISTORY",
};

const ALL_ENV_KEYS = Object.values(ENV_KEYS);

function isPresent(env, key) {
  return env[key] !== undefined;
}

function isEnabled(env = process.env) {
  return ALL_ENV_KEYS.some((key) => isPresent(env, key));
}

function fail(message) {
  throw new Error(`[KeplerLLM] ${message}`);
}

function decodeUtf8Fatal(buffer, contextMessage) {
  try {
    const Decoder = globalThis.TextDecoder || require("util").TextDecoder;
    const decoder = new Decoder("utf-8", { fatal: true });
    return decoder.decode(buffer);
  } catch {
    fail(
      `${contextMessage} is not valid UTF-8. Provide the prompt as valid UTF-8 text.`
    );
  }
}

function resolveSystemPrompt(env = process.env) {
  const hasFile = isPresent(env, ENV_KEYS.PROMPT_FILE);
  const hasBase64 = isPresent(env, ENV_KEYS.PROMPT_BASE64);
  const hasPlain = isPresent(env, ENV_KEYS.PROMPT);

  if (hasFile) {
    const filePath = env[ENV_KEYS.PROMPT_FILE];
    if (typeof filePath !== "string" || String(filePath).trim() === "") {
      fail(
        `${ENV_KEYS.PROMPT_FILE} must not be empty. Set it to a readable UTF-8 file path or unset it.`
      );
    }
    const path = String(filePath);
    let buffer;
    try {
      buffer = fs.readFileSync(path);
    } catch (error) {
      const code = error?.code;
      if (code === "ENOENT") {
        fail(
          `${ENV_KEYS.PROMPT_FILE} does not exist: ${path}. Mount the secret file and restart.`
        );
      }
      if (code === "EACCES" || code === "EPERM") {
        fail(
          `${ENV_KEYS.PROMPT_FILE} is not readable: ${path}. Check file permissions and restart.`
        );
      }
      if (code === "EISDIR") {
        fail(
          `${ENV_KEYS.PROMPT_FILE} is a directory, not a file: ${path}. Set it to a UTF-8 text file and restart.`
        );
      }
      fail(
        `${ENV_KEYS.PROMPT_FILE} could not be read: ${path}. (${error?.message || "unknown error"})`
      );
    }
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    const text = decodeUtf8Fatal(buffer, `${ENV_KEYS.PROMPT_FILE} (${path})`);
    // Preserve contents verbatim. An empty file means "no prompt configured"
    // so upstream defaults stay intact instead of storing an empty value.
    return {
      source: "file",
      bytes: buffer.length,
      openAiPrompt: text === "" ? undefined : text,
    };
  }

  if (hasBase64) {
    const raw = env[ENV_KEYS.PROMPT_BASE64];
    if (typeof raw !== "string") {
      fail(
        `${ENV_KEYS.PROMPT_BASE64} must be standard Base64 text. Fix the value and restart.`
      );
    }
    // Ignore ASCII whitespace in the encoded payload so wrapped `base64`
    // output keeps working. Decoded bytes are preserved verbatim.
    const sanitized = raw.replace(/\s/g, "");
    if (
      sanitized.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(sanitized)
    ) {
      fail(
        `${ENV_KEYS.PROMPT_BASE64} is malformed Base64. Re-encode the prompt with standard Base64 (for example: base64 < system-prompt.txt | tr -d '\\n') and restart. The plain-text variable is not used when Base64 is present.`
      );
    }
    let buffer;
    try {
      buffer = Buffer.from(sanitized, "base64");
    } catch {
      fail(
        `${ENV_KEYS.PROMPT_BASE64} is malformed Base64. Re-encode the prompt with standard Base64 and restart.`
      );
    }
    const text = decodeUtf8Fatal(buffer, `${ENV_KEYS.PROMPT_BASE64}`);
    return {
      source: "base64",
      bytes: buffer.length,
      openAiPrompt: text === "" ? undefined : text,
    };
  }

  if (hasPlain) {
    const raw = env[ENV_KEYS.PROMPT];
    if (typeof raw !== "string") {
      fail(`${ENV_KEYS.PROMPT} must be text. Fix the value and restart.`);
    }
    // Use the value verbatim: no trimming, collapsing, or newline changes.
    if (raw === "") {
      return { source: "plain", bytes: 0, openAiPrompt: undefined };
    }
    return {
      source: "plain",
      bytes: Buffer.byteLength(raw, "utf8"),
      openAiPrompt: raw,
    };
  }

  return { source: null, bytes: null, openAiPrompt: undefined };
}

function parseChatMode(env = process.env) {
  if (!isPresent(env, ENV_KEYS.CHAT_MODE)) return undefined;
  const { Workspace } = require("../../models/workspace");
  const valid = Workspace.VALID_CHAT_MODES;
  const raw = env[ENV_KEYS.CHAT_MODE];
  if (typeof raw !== "string" || !valid.includes(raw)) {
    fail(
      `${ENV_KEYS.CHAT_MODE} has an invalid value. Accepted values: ${valid.join(", ")}.`
    );
  }
  return raw;
}

function parseTemperature(env = process.env) {
  if (!isPresent(env, ENV_KEYS.TEMPERATURE)) return undefined;
  const raw = env[ENV_KEYS.TEMPERATURE];
  const text = String(raw).trim();
  if (text === "") {
    fail(
      `${ENV_KEYS.TEMPERATURE} must not be empty. Set it to a number >= 0 (for example "1") or unset it.`
    );
  }
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) {
    fail(
      `${ENV_KEYS.TEMPERATURE} has an invalid value ${JSON.stringify(text)}. Set it to a number >= 0 (for example "1") or unset it.`
    );
  }
  const num = Number(text);
  if (!Number.isFinite(num)) {
    fail(
      `${ENV_KEYS.TEMPERATURE} has an invalid value ${JSON.stringify(text)}. Set it to a number >= 0 (for example "1") or unset it.`
    );
  }
  if (num < 0) {
    fail(
      `${ENV_KEYS.TEMPERATURE} has an invalid value ${JSON.stringify(text)}. Temperature must be >= 0.`
    );
  }
  return num;
}

function parseHistory(env = process.env) {
  if (!isPresent(env, ENV_KEYS.HISTORY)) return undefined;
  const raw = env[ENV_KEYS.HISTORY];
  const text = String(raw).trim();
  if (text === "") {
    fail(
      `${ENV_KEYS.HISTORY} must not be empty. Set it to an integer >= 0 (for example "20") or unset it.`
    );
  }
  if (!/^-?\d+$/.test(text)) {
    fail(
      `${ENV_KEYS.HISTORY} has an invalid value ${JSON.stringify(text)}. Set it to an integer >= 0 (for example "20") or unset it.`
    );
  }
  const num = Number(text);
  if (!Number.isInteger(num)) {
    fail(
      `${ENV_KEYS.HISTORY} has an invalid value ${JSON.stringify(text)}. Set it to an integer >= 0 (for example "20") or unset it.`
    );
  }
  if (num < 0) {
    fail(
      `${ENV_KEYS.HISTORY} has an invalid value ${JSON.stringify(text)}. History must be >= 0.`
    );
  }
  return num;
}

/**
 * Parse and validate DEFAULT_WORKSPACE_* environment variables.
 * Unset variables are omitted so upstream defaults stay intact.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{enabled:boolean, name?:string, slug?:string, openAiPrompt?:string, chatMode?:string, openAiTemp?:number, openAiHistory?:number, systemPromptSource:string|null, systemPromptBytes:number|null}}
 */
function parseDefaultWorkspaceConfig(env = process.env) {
  if (!isEnabled(env)) return { enabled: false };

  const nameRaw = env[ENV_KEYS.NAME];
  if (nameRaw === undefined) {
    fail(
      `${ENV_KEYS.NAME} is required when any ${"DEFAULT_WORKSPACE_*"} variable is set. Set ${ENV_KEYS.NAME} to the workspace name and restart.`
    );
  }
  if (typeof nameRaw !== "string" || nameRaw.trim() === "") {
    fail(
      `${ENV_KEYS.NAME} must not be empty. Set it to the workspace name and restart.`
    );
  }
  // Preserve the name verbatim; Workspace.validations.name applies the
  // upstream truncation when persisting.
  const name = String(nameRaw);

  let slug;
  if (isPresent(env, ENV_KEYS.SLUG)) {
    const slugRaw = env[ENV_KEYS.SLUG];
    if (typeof slugRaw !== "string" || String(slugRaw).trim() === "") {
      fail(
        `${ENV_KEYS.SLUG} must not be empty. Set it to the workspace slug (for example "kepler") or unset it to use automatic slug generation.`
      );
    }
    slug = String(slugRaw).trim();
  }

  const prompt = resolveSystemPrompt(env);
  const chatMode = parseChatMode(env);
  const openAiTemp = parseTemperature(env);
  const openAiHistory = parseHistory(env);

  const config = {
    enabled: true,
    name,
    systemPromptSource: prompt.source,
    systemPromptBytes: prompt.bytes,
  };
  if (slug !== undefined) config.slug = slug;
  if (prompt.openAiPrompt !== undefined)
    config.openAiPrompt = prompt.openAiPrompt;
  if (chatMode !== undefined) config.chatMode = chatMode;
  if (openAiTemp !== undefined) config.openAiTemp = openAiTemp;
  if (openAiHistory !== undefined) config.openAiHistory = openAiHistory;
  return config;
}

async function defaultSystemPromptFallback(WorkspaceModel) {
  try {
    const { SystemSettings } = require("../../models/systemSettings");
    const stored = await SystemSettings.get({ label: "default_system_prompt" });
    if (stored?.value) return stored.value;
  } catch {
    // Fall through to the model default when settings are unavailable.
  }
  return WorkspaceModel.defaultPrompt;
}

async function buildCreateDataWithExactSlug(
  config,
  WorkspaceModel,
  getSystemDefaultPrompt
) {
  const fields = {};
  if (config.openAiPrompt !== undefined)
    fields.openAiPrompt = config.openAiPrompt;
  if (config.chatMode !== undefined) fields.chatMode = config.chatMode;
  if (config.openAiTemp !== undefined) fields.openAiTemp = config.openAiTemp;
  if (config.openAiHistory !== undefined)
    fields.openAiHistory = config.openAiHistory;

  if (!fields.openAiPrompt) {
    if (typeof getSystemDefaultPrompt === "function") {
      const value = await getSystemDefaultPrompt();
      fields.openAiPrompt = value || WorkspaceModel.defaultPrompt;
    } else {
      fields.openAiPrompt = await defaultSystemPromptFallback(WorkspaceModel);
    }
  }

  const validated = WorkspaceModel.validateFields(fields);
  return {
    name: WorkspaceModel.validations.name(config.name),
    chatMode: "automatic",
    ...validated,
    slug: config.slug,
  };
}

function safeSummary(config) {
  const workspace = config.slug || config.name;
  const source =
    config.systemPromptSource === null ? "none" : config.systemPromptSource;
  const bytes =
    config.systemPromptBytes === null ? "none" : config.systemPromptBytes;
  return `workspace=${workspace} systemPromptSource=${source} systemPromptBytes=${bytes}`;
}

/**
 * Bootstrap the default workspace once. Idempotent: when the workspace
 * already exists the database is treated as the source of truth and no
 * values are overwritten.
 * @param {{env?:NodeJS.ProcessEnv, WorkspaceModel?:Object, getSystemDefaultPrompt?:Function, logger?:Object}} [options]
 */
async function bootstrapDefaultWorkspace({
  env = process.env,
  WorkspaceModel = null,
  getSystemDefaultPrompt = null,
  logger = console,
} = {}) {
  const config = parseDefaultWorkspaceConfig(env);
  if (!config.enabled) return { bootstrapped: false, reason: "disabled" };

  const WM = WorkspaceModel || require("../../models/workspace").Workspace;

  // Explicit slug identifies the workspace.
  if (config.slug) {
    const existing = await WM.get({ slug: config.slug });
    if (existing) {
      logger.log(
        `[KeplerLLM] Default workspace bootstrap skipped (already exists) ${safeSummary(config)}`
      );
      return { bootstrapped: true, created: false, workspace: existing };
    }

    const createData = await buildCreateDataWithExactSlug(
      config,
      WM,
      getSystemDefaultPrompt
    );

    try {
      const result = await WM.upsert({ slug: config.slug }, createData, {});
      if (result?.error) {
        const raced = await WM.get({ slug: config.slug });
        if (raced) {
          logger.log(
            `[KeplerLLM] Default workspace bootstrap skipped (already exists) ${safeSummary(config)}`
          );
          return { bootstrapped: true, created: false, workspace: raced };
        }
        fail(
          `Failed to bootstrap default workspace '${config.slug}': ${result.error}`
        );
      }
      logger.log(
        `[KeplerLLM] Default workspace bootstrap enabled (created) ${safeSummary(config)}`
      );
      return { bootstrapped: true, created: true, workspace: result.workspace };
    } catch (error) {
      if (error?.message?.startsWith("[KeplerLLM] Failed to bootstrap"))
        throw error;
      // Concurrent initialization may have created the row first.
      const raced = await WM.get({ slug: config.slug }).catch(() => null);
      if (raced) {
        logger.log(
          `[KeplerLLM] Default workspace bootstrap skipped (already exists) ${safeSummary(config)}`
        );
        return { bootstrapped: true, created: false, workspace: raced };
      }
      throw error;
    }
  }

  // No explicit slug: identify by name first (survives the automatic
  // suffixed-slug case), then fall back to creation with upstream slug
  // generation. The slug itself is never used to overwrite anything.
  const existingByName = await WM.get({ name: config.name });
  if (existingByName) {
    logger.log(
      `[KeplerLLM] Default workspace bootstrap skipped (already exists) ${safeSummary(config)}`
    );
    return { bootstrapped: true, created: false, workspace: existingByName };
  }

  let expectedSlug = null;
  try {
    expectedSlug = WM.slugify(config.name, { lower: true }) || null;
  } catch {
    expectedSlug = null;
  }

  const additionalFields = {};
  if (config.openAiPrompt !== undefined)
    additionalFields.openAiPrompt = config.openAiPrompt;
  if (config.chatMode !== undefined)
    additionalFields.chatMode = config.chatMode;
  if (config.openAiTemp !== undefined)
    additionalFields.openAiTemp = config.openAiTemp;
  if (config.openAiHistory !== undefined)
    additionalFields.openAiHistory = config.openAiHistory;

  try {
    const { workspace, message } = await WM.new(
      config.name,
      null,
      additionalFields
    );
    if (workspace) {
      logger.log(
        `[KeplerLLM] Default workspace bootstrap enabled (created) ${safeSummary(config)}`
      );
      return { bootstrapped: true, created: true, workspace };
    }
    const racedByName = await WM.get({ name: config.name });
    if (racedByName) {
      logger.log(
        `[KeplerLLM] Default workspace bootstrap skipped (already exists) ${safeSummary(config)}`
      );
      return { bootstrapped: true, created: false, workspace: racedByName };
    }
    if (expectedSlug) {
      const racedBySlug = await WM.get({ slug: expectedSlug });
      if (racedBySlug && racedBySlug.name === config.name) {
        logger.log(
          `[KeplerLLM] Default workspace bootstrap skipped (already exists) ${safeSummary(config)}`
        );
        return { bootstrapped: true, created: false, workspace: racedBySlug };
      }
    }
    fail(
      `Failed to bootstrap default workspace '${config.name}': ${message || "unknown error"}`
    );
  } catch (error) {
    if (error?.message?.startsWith("[KeplerLLM] Failed to bootstrap"))
      throw error;
    const raced = await WM.get({ name: config.name }).catch(() => null);
    if (raced) {
      logger.log(
        `[KeplerLLM] Default workspace bootstrap skipped (already exists) ${safeSummary(config)}`
      );
      return { bootstrapped: true, created: false, workspace: raced };
    }
    throw error;
  }
}

module.exports = {
  ENV_KEYS,
  ALL_ENV_KEYS,
  isEnabled,
  parseDefaultWorkspaceConfig,
  bootstrapDefaultWorkspace,
};
