const {
  parseBooleanEnv,
} = require("../helpers/parseBooleanEnv");

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

// KeplerLLM fork: optional UI-only visibility controls. Strict boolean
// semantics shared with KEPLERLLM_HIDE_SETTINGS_BUTTONS,
// DISABLE_VIEW_CHAT_HISTORY and WORKSPACE_DELETION_PROTECTION: only "true"
// or "1" (case-insensitive, whitespace trimmed) hide; unset, "", "false",
// "0", or any other value means normal behavior. Only normalized booleans
// are exposed to the frontend (never raw env values).
const HIDE_TOOLS_BUTTON_ENV = "KEPLERLLM_HIDE_TOOLS_BUTTON";
const HIDE_CREATE_AGENT_BUTTON_ENV = "KEPLERLLM_HIDE_CREATE_AGENT_BUTTON";
const HIDE_EDIT_WORKSPACE_BUTTON_ENV = "KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON";
const HIDE_UPLOAD_DOCUMENT_BUTTON_ENV = "KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON";

function resolveHideToolsButton(env = process.env) {
  return parseBooleanEnv(env?.[HIDE_TOOLS_BUTTON_ENV]);
}

function resolveHideCreateAgentButton(env = process.env) {
  return parseBooleanEnv(env?.[HIDE_CREATE_AGENT_BUTTON_ENV]);
}

function resolveHideEditWorkspaceButton(env = process.env) {
  return parseBooleanEnv(env?.[HIDE_EDIT_WORKSPACE_BUTTON_ENV]);
}

function resolveHideUploadDocumentButton(env = process.env) {
  return parseBooleanEnv(env?.[HIDE_UPLOAD_DOCUMENT_BUTTON_ENV]);
}

function resolveVisibilityFlags(env = process.env) {
  return {
    hideToolsButton: resolveHideToolsButton(env),
    hideCreateAgentButton: resolveHideCreateAgentButton(env),
    hideEditWorkspaceButton: resolveHideEditWorkspaceButton(env),
    hideUploadDocumentButton: resolveHideUploadDocumentButton(env),
  };
}

// KeplerLLM fork: temporary Safari/WebKit cross-origin iframe link-click
// compatibility workaround. Strict boolean semantics shared with the
// visibility flags: only "true" or "1" (case-insensitive, whitespace
// trimmed) enable; unset, "", "false", "0", or any other value disable.
// Default is disabled (opt-in). Only the normalized boolean is exposed to
// the frontend (never the raw env value).
const SAFARI_IFRAME_LINK_FIX_ENV = "KEPLERLLM_SAFARI_IFRAME_LINK_FIX";

function resolveSafariIframeLinkFix(env = process.env) {
  return parseBooleanEnv(env?.[SAFARI_IFRAME_LINK_FIX_ENV]);
}

// Inline boot script rendered by MetaGenerator before the app bundle.
// JSON-escaped so an operator-provided label cannot break out of the
// script element.
function keplerllmConfigScript(env = process.env) {
  const payload = JSON.stringify({
    modelDisplayName: resolveModelDisplayName(env),
    defaultUILanguage: resolveDefaultUILanguage(env),
    ...resolveVisibilityFlags(env),
    safariIframeLinkFix: resolveSafariIframeLinkFix(env),
  }).replace(/</g, "\\u003c");
  return `<script>window.__KEPLERLLM_CONFIG__=${payload};</script>`;
}

module.exports = {
  DEFAULT_MODEL_DISPLAY_NAME,
  HIDE_TOOLS_BUTTON_ENV,
  HIDE_CREATE_AGENT_BUTTON_ENV,
  HIDE_EDIT_WORKSPACE_BUTTON_ENV,
  HIDE_UPLOAD_DOCUMENT_BUTTON_ENV,
  SAFARI_IFRAME_LINK_FIX_ENV,
  resolveModelDisplayName,
  resolveDefaultUILanguage,
  resolveHideToolsButton,
  resolveHideCreateAgentButton,
  resolveHideEditWorkspaceButton,
  resolveHideUploadDocumentButton,
  resolveVisibilityFlags,
  resolveSafariIframeLinkFix,
  keplerllmConfigScript,
};
