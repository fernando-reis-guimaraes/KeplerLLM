/**
 * KeplerLLM fork: remote MCP servers defined through environment variables.
 *
 * Compact syntax (no JSON inside envvars, `|` is the reserved delimiter):
 *   MCP_<NAME>=<URL>[|<AUTH_OR_HEADER>...]
 *
 * Supported forms:
 *   <URL>
 *   <URL>|Bearer|<TOKEN>
 *   <URL>|Basic|<USERNAME>:<PASSWORD>
 *   <URL>|<HEADER>|<VALUE> [...]
 *   <URL>|Bearer|<TOKEN>|<HEADER>|<VALUE> [...]
 *   <URL>|Basic|<USERNAME>:<PASSWORD>|<HEADER>|<VALUE> [...]
 *
 * Notes:
 * - `MCP_` prefix is removed, remainder is lowercased and `_` becomes `-`.
 * - Environment definitions are always remote Streamable HTTP servers.
 * - `Bearer` / `Basic` are matched case-insensitively in the auth position.
 * - `Basic` uses exactly ONE value `Username:Password`, split on FIRST `:`.
 * - `|` is reserved. No escaping, quoting, or `\|` is supported.
 * - Discovery is conservative: a `MCP_*` variable is only treated as a server
 *   when its value begins with a valid `http://` or `https://` URL. This keeps
 *   unrelated flags such as `MCP_NO_COOLDOWN` out of server discovery.
 */

const MCP_ENV_PREFIX = "MCP_";

// Existing non-server `MCP_*` flags that must never become MCP servers,
// even if their value ever looked like a URL.
const IGNORED_MCP_ENV_KEYS = new Set(["MCP_NO_COOLDOWN"]);

/**
 * Normalize an environment key to an MCP server name.
 * MCP_CLASSLOG_BANCO_DADOS -> classlog-banco-dados
 * @param {string} envKey - e.g. "MCP_CLASSLOG_BANCO_DADOS"
 * @returns {string} normalized name ("" when there is no suffix)
 */
function normalizeEnvServerName(envKey = "") {
  const suffix = String(envKey).startsWith(MCP_ENV_PREFIX)
    ? String(envKey).slice(MCP_ENV_PREFIX.length)
    : String(envKey);
  return suffix.toLowerCase().replace(/_/g, "-");
}

/**
 * Check whether a raw env value even qualifies as an MCP server definition.
 * Conservative discovery: first `|` segment must start with http(s)://.
 * @param {*} rawValue
 * @returns {boolean}
 */
function isMCPEnvCandidate(rawValue) {
  if (typeof rawValue !== "string") return false;
  const firstSegment = rawValue.split("|")[0].trim();
  return (
    firstSegment.toLowerCase().startsWith("http://") ||
    firstSegment.toLowerCase().startsWith("https://")
  );
}

/**
 * Validate that a URL string is a remote http/https URL.
 * @param {string} urlString
 * @returns {boolean}
 */
function isValidRemoteHttpUrl(urlString) {
  try {
    const parsed = new URL(String(urlString).trim());
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Parse a single MCP envvar value into a normalized server config.
 * Never throws with secrets: error messages are generic and contain no
 * tokens, passwords, header values, or URL paths.
 * @param {*} rawValue - raw environment variable value
 * @returns {{ ok: boolean, config?: { type: string, url: string, headers?: Object }, error?: string }}
 */
function parseMCPEnvValue(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return {
      ok: false,
      error:
        "Invalid MCP definition: value must start with a valid http:// or https:// URL.",
    };
  }

  // `|` is the reserved delimiter. No escaping is supported by design.
  const segments = rawValue.split("|").map((part) => part.trim());

  const url = segments[0];
  if (!isValidRemoteHttpUrl(url)) {
    return {
      ok: false,
      error:
        "Invalid MCP definition: first segment must be a valid http:// or https:// URL.",
    };
  }

  const rest = segments.slice(1);
  if (rest.length === 0) {
    return { ok: true, config: { type: "streamable", url } };
  }

  const headers = {};
  let cursor = 0;

  const firstDirective = rest[0].toLowerCase();
  if (firstDirective === "bearer" || firstDirective === "basic") {
    const credential = rest[1];
    if (credential === undefined || credential === "") {
      return {
        ok: false,
        error: `Invalid MCP definition: "${rest[0]}" requires a credential value.`,
      };
    }

    if (firstDirective === "bearer") {
      // Canonical HTTP scheme spelling in the generated value.
      headers["Authorization"] = `Bearer ${credential}`;
    } else {
      const colonIndex = credential.indexOf(":");
      if (colonIndex === -1) {
        return {
          ok: false,
          error:
            'Invalid MCP definition: "Basic" requires exactly "Username:Password" containing a colon.',
        };
      }
      const username = credential.slice(0, colonIndex).trim();
      // Password may contain additional colons: split on FIRST `:` only.
      const password = credential.slice(colonIndex + 1).trim();
      if (!username || !password) {
        return {
          ok: false,
          error:
            'Invalid MCP definition: "Basic" requires a non-empty username and password in "Username:Password" form.',
        };
      }
      const encoded = Buffer.from(`${username}:${password}`, "utf8").toString(
        "base64"
      );
      headers["Authorization"] = `Basic ${encoded}`;
    }
    cursor = 2;
  }

  const remaining = rest.slice(cursor);
  if (remaining.length % 2 !== 0) {
    return {
      ok: false,
      error:
        "Invalid MCP definition: headers must be complete <HEADER>|<VALUE> pairs.",
    };
  }

  for (let i = 0; i < remaining.length; i += 2) {
    const headerName = remaining[i];
    const headerValue = remaining[i + 1];
    if (!headerName || !headerValue) {
      return {
        ok: false,
        error:
          "Invalid MCP definition: headers must be complete <HEADER>|<VALUE> pairs with non-empty names and values.",
      };
    }
    // Preserve header names and values verbatim (besides surrounding
    // whitespace trimming). Only Bearer/Basic are special.
    headers[headerName] = headerValue;
  }

  const config = { type: "streamable", url };
  if (Object.keys(headers).length > 0) config.headers = headers;
  return { ok: true, config };
}

/**
 * Scan an env object for MCP server definitions.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{ servers: { [name: string]: { envKey: string, config: Object } }, errors: { [name: string]: { envKey: string, message: string } } }}
 */
function parseMCPEnvironment(env = process.env) {
  const servers = {};
  const errors = {};

  const keys = Object.keys(env || {})
    .filter((key) => key.startsWith(MCP_ENV_PREFIX))
    .filter((key) => !IGNORED_MCP_ENV_KEYS.has(key))
    .sort();

  for (const envKey of keys) {
    const rawValue = env[envKey];
    if (!isMCPEnvCandidate(rawValue)) continue;

    const name = normalizeEnvServerName(envKey);
    if (!name) continue;

    const parsed = parseMCPEnvValue(rawValue);
    if (parsed.ok) {
      // Deterministic: sorted keys, last duplicate wins.
      servers[name] = { envKey, config: parsed.config };
    } else {
      errors[name] = { envKey, message: parsed.error };
    }
  }

  return { servers, errors };
}

/**
 * Merge file-based definitions with environment definitions.
 * Environment wins by server name. For overridden servers the safe
 * `anythingllm` metadata (suppressedTools, autoStart) from the file is
 * preserved so UI toggles keep working without persisting secrets.
 * @param {{ [name: string]: Object }} fileServers
 * @param {{ [name: string]: { envKey: string, config: Object } | Object }} envServers
 * @returns {{ servers: { [name: string]: Object }, sources: { [name: string]: "environment" | "file" } }}
 */
function mergeMCPDefinitions(fileServers = {}, envServers = {}) {
  const servers = {};
  const sources = {};

  const normalizedEnv = {};
  for (const [name, entry] of Object.entries(envServers || {})) {
    normalizedEnv[name] =
      entry && typeof entry === "object" && "config" in entry
        ? entry.config
        : entry;
  }

  for (const [name, fileConfig] of Object.entries(fileServers || {})) {
    if (normalizedEnv[name]) {
      servers[name] = { ...normalizedEnv[name] };
      if (
        fileConfig &&
        typeof fileConfig === "object" &&
        fileConfig.anythingllm !== undefined
      ) {
        servers[name].anythingllm = fileConfig.anythingllm;
      }
      sources[name] = "environment";
    } else {
      // A file entry containing ONLY safe `anythingllm` metadata is an
      // orphaned stub left behind for a removed env server (used to persist
      // tool-suppression state). It is not a real server definition, so it
      // stays invisible instead of surfacing as a broken server.
      const keys = Object.keys(fileConfig || {});
      const onlyMetadata =
        keys.length > 0 && keys.every((key) => key === "anythingllm");
      if (onlyMetadata) continue;
      servers[name] = fileConfig;
      sources[name] = "file";
    }
  }

  for (const [name, envConfig] of Object.entries(normalizedEnv)) {
    if (servers[name]) continue;
    const fileConfig = (fileServers || {})[name];
    servers[name] = { ...envConfig };
    if (
      fileConfig &&
      typeof fileConfig === "object" &&
      fileConfig.anythingllm !== undefined
    ) {
      servers[name].anythingllm = fileConfig.anythingllm;
    }
    sources[name] = "environment";
  }

  return { servers, sources };
}

/**
 * Extract only the safe host portion of a URL (hostname + port when present).
 * Strips credentials, path, query string, and fragment via URL parsing.
 * @param {string} urlString
 * @returns {string|null}
 */
function safeDomainForUrl(urlString) {
  try {
    const parsed = new URL(String(urlString));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return parsed.host || null;
  } catch {
    return null;
  }
}

/**
 * Infer the effective transport type label for a server definition.
 * @param {Object} server
 * @returns {string}
 */
function effectiveServerType(server = {}) {
  if (server.type) return server.type;
  if (Object.prototype.hasOwnProperty.call(server, "command")) return "stdio";
  if (Object.prototype.hasOwnProperty.call(server, "url")) return "sse";
  return "unknown";
}

/**
 * Replace embedded http(s) URLs in a message with their safe host only,
 * so transport errors carrying secret paths/queries never leak to logs or UI.
 * @param {string} message
 * @returns {string}
 */
function sanitizeErrorMessage(message) {
  if (typeof message !== "string" || message === "") return message;
  return message.replace(/https?:\/\/[^\s"'`]+/gi, (match) => {
    // Trim trailing punctuation that is sentence punctuation, not URL.
    const trimmed = match.replace(/[),.;:!?]+$/, "");
    const trailing = match.slice(trimmed.length);
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return "[redacted-url]";
      return (parsed.host || "[redacted-url]") + trailing;
    } catch {
      return "[redacted-url]";
    }
  });
}

/**
 * Build the safe frontend/API representation of an MCP server definition.
 * Never includes: full URLs, paths, queries, credentials, header values,
 * or original envvar values. Only the hostname, type, source, header names,
 * and safe `anythingllm` metadata are exposed.
 * @param {string} name
 * @param {Object} server - effective internal server config (with secrets)
 * @param {"environment"|"file"} source
 * @returns {{ name: string, source: string, type: string, domain: string|null, headerNames: string[], config: Object }}
 */
function sanitizeServerForFrontend(name, server = {}, source = "file") {
  const type = effectiveServerType(server);
  const domain = server.url ? safeDomainForUrl(server.url) : null;
  const headerNames = server.headers ? Object.keys(server.headers) : [];

  const safeConfig = {
    type,
    source,
    domain,
    headerNames: [...headerNames],
    anythingllm: server.anythingllm || {},
  };

  // Preserve stdio launch info so the existing admin UI keeps working.
  // Secrets live in `env`, which is never returned.
  if (Object.prototype.hasOwnProperty.call(server, "command")) {
    safeConfig.command = server.command;
    safeConfig.args = Array.isArray(server.args) ? [...server.args] : [];
  }

  return {
    name,
    source,
    type,
    domain,
    headerNames: [...headerNames],
    config: safeConfig,
  };
}

module.exports = {
  MCP_ENV_PREFIX,
  IGNORED_MCP_ENV_KEYS,
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
};
