const fs = require("fs");
const path = require("path");

// Regression coverage for the strict boolean environment-variable audit.
// Every boolean configuration flag changed in this change must resolve via
// the shared parser: only "true"/"1" enable, everything else disables.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}

const {
  parseBooleanEnv,
} = require("../../utils/helpers/parseBooleanEnv");
const {
  resolveVisibilityFlags,
} = require("../../utils/boot/keplerllmConfig");

const BOOLEAN_FLAGS = [
  "KEPLERLLM_HIDE_SETTINGS_BUTTONS",
  "DISABLE_VIEW_CHAT_HISTORY",
  "WORKSPACE_DELETION_PROTECTION",
  "KEPLERLLM_HIDE_TOOLS_BUTTON",
  "KEPLERLLM_HIDE_CREATE_AGENT_BUTTON",
  "KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON",
  "KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON",
];

const ENABLED_VALUES = ["true", "TRUE", " true ", "1", " 1 "];
const DISABLED_VALUES = [
  "false",
  "FALSE",
  " false ",
  "0",
  " 0 ",
  "",
  "null",
  "undefined",
  "yes",
  "no",
  "on",
  "off",
  "abc",
];

describe("strict boolean env flags (regression)", () => {
  it.each(BOOLEAN_FLAGS)("%s: true/1 -> true, all else -> false", (name) => {
    for (const value of ENABLED_VALUES) {
      expect(parseBooleanEnv(value)).toBe(true);
    }
    expect(parseBooleanEnv(undefined)).toBe(false);
    for (const value of DISABLED_VALUES) {
      expect(parseBooleanEnv(value)).toBe(false);
    }
    // Live process.env round-trip for the exact variable name.
    const had = name in process.env;
    const saved = process.env[name];
    try {
      delete process.env[name];
      expect(parseBooleanEnv(process.env[name])).toBe(false);
      process.env[name] = "false";
      expect(parseBooleanEnv(process.env[name])).toBe(false);
      process.env[name] = "0";
      expect(parseBooleanEnv(process.env[name])).toBe(false);
      process.env[name] = "";
      expect(parseBooleanEnv(process.env[name])).toBe(false);
      process.env[name] = "true";
      expect(parseBooleanEnv(process.env[name])).toBe(true);
      process.env[name] = "1";
      expect(parseBooleanEnv(process.env[name])).toBe(true);
    } finally {
      if (had) process.env[name] = saved;
      else delete process.env[name];
    }
  });

  it("visibility resolvers use the shared strict rule", () => {
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_TOOLS_BUTTON: "false" })
        .hideToolsButton
    ).toBe(false);
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_TOOLS_BUTTON: "true" })
        .hideToolsButton
    ).toBe(true);
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_CREATE_AGENT_BUTTON: "0" })
        .hideCreateAgentButton
    ).toBe(false);
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON: "" })
        .hideEditWorkspaceButton
    ).toBe(false);
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON: "1" })
        .hideUploadDocumentButton
    ).toBe(true);
  });

  it("changed locations no longer use presence/truthiness for these flags", () => {
    const systemSettings = readRepoFile(
      "server",
      "models",
      "systemSettings.js"
    );
    const chatHistory = readRepoFile(
      "server",
      "utils",
      "middleware",
      "chatHistoryViewable.js"
    );
    const deletion = readRepoFile(
      "server",
      "utils",
      "middleware",
      "workspaceDeletionProtection.js"
    );
    const visibility = readRepoFile(
      "server",
      "utils",
      "boot",
      "keplerllmConfig.js"
    );
    for (const name of [
      "DISABLE_VIEW_CHAT_HISTORY",
      "WORKSPACE_DELETION_PROTECTION",
      "KEPLERLLM_HIDE_SETTINGS_BUTTONS",
    ]) {
      expect(systemSettings).not.toContain(`"${name}" in process.env`);
    }
    expect(chatHistory).not.toContain('"DISABLE_VIEW_CHAT_HISTORY" in process');
    expect(deletion).not.toContain(
      '"WORKSPACE_DELETION_PROTECTION" in process'
    );
    expect(visibility).not.toContain("in Object(env)");
    expect(visibility).toContain("parseBooleanEnv");
    expect(chatHistory).toContain("parseBooleanEnv");
    expect(deletion).toContain("parseBooleanEnv");
  });

  it("credential presence checks keep their existing meaning", () => {
    const systemSettings = readRepoFile(
      "server",
      "models",
      "systemSettings.js"
    );
    // Spot-check: secret/key indicators still use presence (!!), not the
    // boolean VALUE parser.
    expect(systemSettings).toContain("!!process.env.OPEN_AI_KEY");
    expect(systemSettings).toContain("!!process.env.AUTH_TOKEN");
    expect(systemSettings).toContain("!!process.env.ANTHROPIC_API_KEY");
  });
});
