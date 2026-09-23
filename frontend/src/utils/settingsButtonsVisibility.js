// KeplerLLM fork: temporary in-memory override for hidden Settings buttons.
// When KEPLERLLM_HIDE_SETTINGS_BUTTONS is present the server reports
// HideSettingsButtons=true via System.keys(). Calling window.showButtons()
// from DevTools reveals the buttons for the current tab only. Nothing is
// persisted and a reload hides them again.

let overrideShown = false;
const listeners = new Set();

export function isSettingsButtonsOverrideActive() {
  return overrideShown;
}

export function subscribeSettingsButtonsOverride(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showSettingsButtonsOverride() {
  if (overrideShown) return;
  overrideShown = true;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

if (typeof window !== "undefined") {
  window.showButtons = showSettingsButtonsOverride;
}
