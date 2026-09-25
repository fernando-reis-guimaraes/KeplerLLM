// KeplerLLM fork: runtime UI visibility controls.
//
// The server exposes normalized booleans through the existing
// `window.__KEPLERLLM_CONFIG__` bootstrap (see
// The server resolves strict boolean semantics server-side: only "true" or
// "1" (case-insensitive, whitespace trimmed) hide; unset, "", "false",
// "0", or any other value means show. The frontend only ever sees
// booleans and must not read raw environment values.
//
// These flags are UI-only. They are not security boundaries: direct routes,
// APIs, drag-and-drop/pasted uploads, slash commands, and backend
// capabilities remain available.

export const DEFAULT_VISIBILITY_FLAGS = Object.freeze({
  hideToolsButton: false,
  hideCreateAgentButton: false,
  hideEditWorkspaceButton: false,
  hideUploadDocumentButton: false,
});

// Read the raw runtime config object. `override` is injectable for tests.
// Falls back to `window.__KEPLERLLM_CONFIG__` (via globalThis) when omitted.
export function readKeplerllmConfig(override = undefined) {
  if (override !== undefined) return override ?? {};
  try {
    if (typeof globalThis !== "undefined") {
      return (
        globalThis.__KEPLERLLM_CONFIG__ ??
        globalThis.window?.__KEPLERLLM_CONFIG__ ??
        {}
      );
    }
  } catch {
    // Storage/global access can throw; treat as no config.
  }
  return {};
}

// Normalize the four visibility flags to booleans. Only an explicit `true`
// hides; anything else (absent, false, null, undefined, raw strings) shows.
export function readVisibilityFlags(runtimeConfig = undefined) {
  const config = readKeplerllmConfig(runtimeConfig);
  return {
    hideToolsButton: config?.hideToolsButton === true,
    hideCreateAgentButton: config?.hideCreateAgentButton === true,
    hideEditWorkspaceButton: config?.hideEditWorkspaceButton === true,
    hideUploadDocumentButton: config?.hideUploadDocumentButton === true,
  };
}

// Tools button (shared PromptInput) is visible unless hidden by runtime config.
export function shouldShowToolsButton(runtimeConfig = undefined) {
  return readVisibilityFlags(runtimeConfig).hideToolsButton !== true;
}

// Resolve Quick Action visibility. Applies existing upstream role logic AND
// the KeplerLLM runtime hide flags.
// - createAgent: admin-only (logged-out users follow upstream `!user` path)
// - editWorkspace: requires an available workspace + admin/manager
// - uploadDocument: any user
export function resolveQuickActionVisibility({
  user = null,
  hasAvailableWorkspace = false,
  runtimeConfig = undefined,
} = {}) {
  const flags = readVisibilityFlags(runtimeConfig);
  const showCreateAgent =
    (!user || ["admin"].includes(user?.role)) &&
    flags.hideCreateAgentButton !== true;
  const showEditWorkspace =
    hasAvailableWorkspace &&
    (!user || ["admin", "manager"].includes(user?.role)) &&
    flags.hideEditWorkspaceButton !== true;
  const showUploadDocument = flags.hideUploadDocumentButton !== true;
  return { showCreateAgent, showEditWorkspace, showUploadDocument };
}

// True when at least one Quick Action is visible.
export function hasVisibleQuickActions(args = {}) {
  const { showCreateAgent, showEditWorkspace, showUploadDocument } =
    resolveQuickActionVisibility(args);
  return Boolean(showCreateAgent || showEditWorkspace || showUploadDocument);
}
