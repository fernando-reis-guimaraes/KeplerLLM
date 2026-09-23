const fs = require("fs");
const path = require("path");

// KeplerLLM fork: KEPLERLLM_HIDE_SETTINGS_BUTTONS optionally hides the
// Settings UI buttons only. Presence semantics match DISABLE_VIEW_CHAT_HISTORY
// and WORKSPACE_DELETION_PROTECTION: any value (including "false") counts.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ENV_VAR = "KEPLERLLM_HIDE_SETTINGS_BUTTONS";

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}

function presenceMapping(env = {}) {
  return ENV_VAR in env || false;
}

describe("KEPLERLLM_HIDE_SETTINGS_BUTTONS presence mapping", () => {
  it("is absent -> false", () => {
    expect(presenceMapping({})).toBe(false);
  });

  it("is present with 1/true/false -> true", () => {
    expect(presenceMapping({ [ENV_VAR]: "1" })).toBe(true);
    expect(presenceMapping({ [ENV_VAR]: "true" })).toBe(true);
    expect(presenceMapping({ [ENV_VAR]: "false" })).toBe(true);
  });

  it("exposes HideSettingsButtons from SystemSettings.currentSettings()", () => {
    const source = readRepoFile(
      "server",
      "models",
      "systemSettings.js"
    );
    expect(source).toContain("HideSettingsButtons");
    expect(source).toContain(
      `"${ENV_VAR}" in process.env || false`
    );
  });
});

describe("hide settings buttons frontend wiring", () => {
  it("hides only the requested controls and exposes showButtons()", () => {
    const settingsButton = readRepoFile(
      "frontend",
      "src",
      "components",
      "SettingsButton",
      "index.jsx"
    );
    expect(settingsButton).toContain("useHideSettingsButtons");
    expect(settingsButton).toContain(
      "if (hideSettingsButtons && !isInSettings) return null;"
    );
    // The Back to workspaces button inside /settings/* must stay visible.
    expect(settingsButton).toContain("if (isInSettings)");
    expect(settingsButton).toContain("ArrowUUpLeft");

    const workspaces = readRepoFile(
      "frontend",
      "src",
      "components",
      "Sidebar",
      "ActiveWorkspaces",
      "index.jsx"
    );
    expect(workspaces).toContain("useHideSettingsButtons");
    expect(workspaces).toContain("!hideSettingsButtons");
    // Upload button must remain unconditionally rendered.
    expect(workspaces).toContain("UploadSimple");
    expect(workspaces).not.toContain("!hideSettingsButtons && (\n                                  <UploadSimple");

    const visibility = readRepoFile(
      "frontend",
      "src",
      "utils",
      "settingsButtonsVisibility.js"
    );
    expect(visibility).toContain("window.showButtons");
    // Temporary in-memory override only: no persistence, no API.
    expect(visibility).not.toContain("localStorage");
    expect(visibility).not.toContain("sessionStorage");
    expect(visibility).not.toContain("fetch(");

    const hook = readRepoFile(
      "frontend",
      "src",
      "hooks",
      "useHideSettingsButtons.js"
    );
    expect(hook).toContain("HideSettingsButtons");
    expect(hook).toContain("System.keys()");
  });

  it("does not add route protection", () => {
    const settingsButton = readRepoFile(
      "frontend",
      "src",
      "components",
      "SettingsButton",
      "index.jsx"
    );
    const workspaces = readRepoFile(
      "frontend",
      "src",
      "components",
      "Sidebar",
      "ActiveWorkspaces",
      "index.jsx"
    );
    for (const source of [settingsButton, workspaces]) {
      expect(source).not.toMatch(/Navigate.*settings/i);
      expect(source).not.toContain("403");
    }
  });
});
