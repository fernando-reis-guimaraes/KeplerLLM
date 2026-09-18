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

// Inline boot script rendered by MetaGenerator before the app bundle.
// JSON-escaped so an operator-provided label cannot break out of the
// script element.
function keplerllmConfigScript(env = process.env) {
  const payload = JSON.stringify({
    modelDisplayName: resolveModelDisplayName(env),
  }).replace(/</g, "\\u003c");
  return `<script>window.__KEPLERLLM_CONFIG__=${payload};</script>`;
}

module.exports = {
  DEFAULT_MODEL_DISPLAY_NAME,
  resolveModelDisplayName,
  keplerllmConfigScript,
};
