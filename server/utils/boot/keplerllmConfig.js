const DEFAULT_MODEL_DISPLAY_NAME = "Kepler AI";

// KeplerLLM fork: product label shown in the workspace model picker.
// Display-only: provider selection, model selection, API requests and
// billing behavior remain unchanged.
//
// - Unset variable: default product label.
// - Empty or whitespace-only override: empty string, so the picker falls
//   back to upstream model-name resolution.
function resolveModelDisplayName(env = process.env) {
  const raw = env?.KEPLERLLM_MODEL_DISPLAY_NAME;
  if (raw == null) return DEFAULT_MODEL_DISPLAY_NAME;
  return String(raw).trim();
}

// DEFAULT_UI_LANGUAGE is a runtime default, not a forced language. The
// server only normalizes the raw value (trim, lowercase, `_` to `-`) and
// rejects clearly invalid tags. The frontend validates the normalized value
// against the locale keys actually exported by
// `frontend/src/locales/resources.js` and ignores unsupported values, so no
// duplicated hardcoded language list is maintained here.
function normalizeDefaultUILanguageTag(raw) {
  if (raw == null) return null;
  const normalized = String(raw).trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return null;
  if (normalized.length > 32) return null;
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(normalized)) return null;
  return normalized;
}

function resolveDefaultUILanguage(env = process.env) {
  return normalizeDefaultUILanguageTag(env?.DEFAULT_UI_LANGUAGE);
}

// Inline boot script rendered by MetaGenerator before the app bundle.
// JSON-escaped so an operator-provided label cannot break out of the
// script element.
function keplerllmConfigScript(env = process.env) {
  const payload = JSON.stringify({
    modelDisplayName: resolveModelDisplayName(env),
    defaultUILanguage: resolveDefaultUILanguage(env),
  }).replace(/</g, "\\u003c");
  return `<script>window.__KEPLERLLM_CONFIG__=${payload};</script>`;
}

module.exports = {
  DEFAULT_MODEL_DISPLAY_NAME,
  resolveModelDisplayName,
  resolveDefaultUILanguage,
  keplerllmConfigScript,
};
