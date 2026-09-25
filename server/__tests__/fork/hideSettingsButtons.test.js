const fs = require("fs");
const path = require("path");

// KeplerLLM fork: KEPLERLLM_HIDE_SETTINGS_BUTTONS hides the Settings UI
// buttons only. Strict boolean semantics: only "true"/"1" (case-insensitive,
// whitespace trimmed) enable; unset, "", "false", "0", or any other value
// shows the buttons normally.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ENV_VAR = "KEPLERLLM_HIDE_SETTINGS_BUTTONS";

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}

const {
  parseBooleanEnv,
} = require("../../utils/helpers/parseBooleanEnv");

function strictMapping(env = {}) {
  return parseBooleanEnv(env[ENV_VAR]);
}

describe("KEPLERLLM_HIDE_SETTINGS_BUTTONS strict boolean mapping", () => {
  it("is absent -> false", () => {
    expect(strictMapping({})).toBe(false);
  });

  it('"true"/"1" (any case, padded) -> true', () => {
    expect(strictMapping({ [ENV_VAR]: "true" })).toBe(true);
    expect(strictMapping({ [ENV_VAR]: "TRUE" })).toBe(true);
    expect(strictMapping({ [ENV_VAR]: " true " })).toBe(true);
    expect(strictMapping({ [ENV_VAR]: "1" })).toBe(true);
    expect(strictMapping({ [ENV_VAR]: " 1 " })).toBe(true);
  });

  it('"false"/"0"/"" and arbitrary values -> false', () => {
    expect(strictMapping({ [ENV_VAR]: "false" })).toBe(false);
    expect(strictMapping({ [ENV_VAR]: "FALSE" })).toBe(false);
    expect(strictMapping({ [ENV_VAR]: " false " })).toBe(false);
    expect(strictMapping({ [ENV_VAR]: "0" })).toBe(false);
    expect(strictMapping({ [ENV_VAR]: "" })).toBe(false);
    expect(strictMapping({ [ENV_VAR]: "null" })).toBe(false);
    expect(strictMapping({ [ENV_VAR]: "yes" })).toBe(false);
    expect(strictMapping({ [ENV_VAR]: "abc" })).toBe(false);
  });

  it("reads the live process.env value through the shared parser", () => {
    const had = ENV_VAR in process.env;
    const saved = process.env[ENV_VAR];
    try {
      delete process.env[ENV_VAR];
      expect(parseBooleanEnv(process.env[ENV_VAR])).toBe(false);
      process.env[ENV_VAR] = "false";
      expect(parseBooleanEnv(process.env[ENV_VAR])).toBe(false);
      process.env[ENV_VAR] = "0";
      expect(parseBooleanEnv(process.env[ENV_VAR])).toBe(false);
      process.env[ENV_VAR] = "";
      expect(parseBooleanEnv(process.env[ENV_VAR])).toBe(false);
      process.env[ENV_VAR] = "true";
      expect(parseBooleanEnv(process.env[ENV_VAR])).toBe(true);
      process.env[ENV_VAR] = "1";
      expect(parseBooleanEnv(process.env[ENV_VAR])).toBe(true);
    } finally {
      if (had) process.env[ENV_VAR] = saved;
      else delete process.env[ENV_VAR];
    }
  });

  it("exposes HideSettingsButtons from SystemSettings.currentSettings() via the shared parser", () => {
    const source = readRepoFile("server", "models", "systemSettings.js");
    expect(source).toContain("HideSettingsButtons");
    expect(source).toContain("parseBooleanEnv");
    expect(source).toContain("process.env.KEPLERLLM_HIDE_SETTINGS_BUTTONS");
    expect(source).not.toContain(
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
