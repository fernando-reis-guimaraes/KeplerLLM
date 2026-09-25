// KeplerLLM fork: shared strict boolean environment-variable parser.
//
// Boolean configuration (for example KEPLERLLM_HIDE_*_BUTTON,
// DISABLE_VIEW_CHAT_HISTORY, WORKSPACE_DELETION_PROTECTION) resolves to
// `true` only for an explicit allowlist and to `false` for everything else.
// In particular, mere presence of a variable must NOT enable a feature, so
// values such as "false", "0", or "" safely resolve to `false`. This matters
// on platforms such as CapRover where operators commonly leave variables
// defined with `false` or empty values.
//
// Accepted `true` values (case-insensitive for strings, whitespace trimmed):
//   true, "true", 1, "1"
// Everything else (including undefined, null, false, "false", 0, "0", "",
// "null", "undefined", "yes", "no", "on", "off", arbitrary strings) resolves
// to `false`. Unknown values never throw.
//
// This helper is for environment variables whose VALUE represents a boolean.
// It must NOT be used for credential-presence checks such as
// `!!process.env.OPEN_AI_KEY` ("is a credential configured?"), which keep
// their existing meaning.
function parseBooleanEnv(value) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

module.exports = {
  parseBooleanEnv,
};
