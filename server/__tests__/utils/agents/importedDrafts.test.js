const fs = require("fs");
const os = require("os");
const path = require("path");

// ImportedPlugin resolves both skill roots from STORAGE_DIR at require time,
// so point it at an isolated temp volume before requiring the module.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "keplerllm-skills-"));
process.env.STORAGE_DIR = tmpRoot;
process.env.NODE_ENV = "test";

const ImportedPlugin = require("../../../utils/agents/imported");

const pluginsRoot = path.join(tmpRoot, "plugins", "agent-skills");
const authoredRoot = path.join(tmpRoot, "anythingllm-fs", "agent-skills");

function writeSkill(
  root,
  hubId,
  { pluginJson, handler = true } = {}
) {
  const folder = path.join(root, hubId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "plugin.json"),
    JSON.stringify(
      pluginJson ?? {
        hubId,
        name: hubId,
        description: "Test skill",
        active: false,
      },
      null,
      2
    )
  );
  if (handler)
    fs.writeFileSync(
      path.join(folder, "handler.js"),
      "module.exports = { runtime: {} };"
    );
  return folder;
}

function skillFolder(root, hubId) {
  return path.join(root, hubId);
}

describe("ImportedPlugin KeplerLLM draft staging", () => {
  beforeEach(() => {
    fs.rmSync(path.join(tmpRoot, "plugins"), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(tmpRoot, "anythingllm-fs"), {
      recursive: true,
      force: true,
    });
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("lists drafts as inactive pending review even when plugin.json claims active", () => {
    writeSkill(authoredRoot, "send-email", {
      pluginJson: { hubId: "send-email", name: "Send Email", active: true },
    });

    const listed = ImportedPlugin.listImportedPlugins();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      hubId: "send-email",
      active: false,
      keplerllmPendingReview: true,
      keplerllmSource: "agent-authored",
    });
  });

  it("lists installed skills unchanged and lets them win hubId collisions", () => {
    writeSkill(pluginsRoot, "send-email", {
      pluginJson: { hubId: "send-email", name: "Installed", active: true },
    });
    writeSkill(authoredRoot, "send-email", {
      pluginJson: { hubId: "send-email", name: "Draft", active: true },
    });

    const listed = ImportedPlugin.listImportedPlugins();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: "Installed", active: true });
    expect(listed[0].keplerllmPendingReview).toBeUndefined();
  });

  it("ignores folders without a parseable plugin.json identity", () => {
    const folder = path.join(authoredRoot, "broken");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "plugin.json"), "{not json");
    writeSkill(authoredRoot, "good-skill");

    const listed = ImportedPlugin.listImportedPlugins();

    expect(listed.map((plugin) => plugin.hubId)).toEqual(["good-skill"]);
  });

  it("never loads or activates drafts in the agent runtime", () => {
    writeSkill(authoredRoot, "send-email", {
      pluginJson: { hubId: "send-email", active: true },
    });

    expect(ImportedPlugin.loadPluginByHubId("send-email")).toBeUndefined();
    expect(ImportedPlugin.activeImportedPlugins()).toEqual([]);
  });

  it("keeps drafts inactive and in place on plain edits", () => {
    writeSkill(authoredRoot, "send-email");

    const updated = ImportedPlugin.updateImportedPlugin("send-email", {
      description: "Edited by admin",
    });

    expect(updated).toMatchObject({
      description: "Edited by admin",
      active: false,
      keplerllmPendingReview: true,
    });
    expect(
      fs.existsSync(skillFolder(authoredRoot, "send-email"))
    ).toBe(true);
    expect(fs.existsSync(skillFolder(pluginsRoot, "send-email"))).toBe(false);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(authoredRoot, "send-email", "plugin.json"),
          "utf8"
        )
      ).active
    ).toBe(false);
  });

  it("drops API-supplied identity and review markers on draft edits", () => {
    writeSkill(authoredRoot, "send-email");

    ImportedPlugin.updateImportedPlugin("send-email", {
      active: false,
      hubId: "spoofed",
      keplerllmPendingReview: false,
      keplerllmSource: "spoofed",
    });

    const stored = JSON.parse(
      fs.readFileSync(
        path.join(authoredRoot, "send-email", "plugin.json"),
        "utf8"
      )
    );
    expect(stored.hubId).toBe("send-email");
    expect(stored.active).toBe(false);
    expect(stored.keplerllmPendingReview).toBeUndefined();
    expect(stored.keplerllmSource).toBeUndefined();
  });

  it("promotes a draft into the executable root on admin activation", () => {
    writeSkill(authoredRoot, "send-email");

    const promoted = ImportedPlugin.updateImportedPlugin("send-email", {
      active: true,
    });

    expect(promoted.active).toBe(true);
    expect(
      fs.existsSync(skillFolder(authoredRoot, "send-email"))
    ).toBe(false);
    expect(fs.existsSync(skillFolder(pluginsRoot, "send-email"))).toBe(true);
    // After promotion File System Access can no longer modify the skill:
    // the authored copy is gone and the installed copy is listed clean.
    const listed = ImportedPlugin.listImportedPlugins();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ hubId: "send-email", active: true });
    expect(listed[0].keplerllmPendingReview).toBeUndefined();
    expect(
      ImportedPlugin.loadPluginByHubId("send-email").config.hubId
    ).toBe("send-email");
  });

  it("refuses promotion when the folder identity mismatches plugin.json", () => {
    writeSkill(authoredRoot, "send-email", {
      pluginJson: { hubId: "other-skill", active: false },
    });

    expect(() =>
      ImportedPlugin.updateImportedPlugin("send-email", { active: true })
    ).toThrow(/hubId mismatch/);
    expect(
      fs.existsSync(skillFolder(authoredRoot, "send-email"))
    ).toBe(true);
    expect(fs.existsSync(skillFolder(pluginsRoot, "send-email"))).toBe(false);
  });

  it("refuses promotion when handler.js is missing", () => {
    writeSkill(authoredRoot, "send-email", { handler: false });

    expect(() =>
      ImportedPlugin.updateImportedPlugin("send-email", { active: true })
    ).toThrow(/handler\.js/);
    expect(
      fs.existsSync(skillFolder(authoredRoot, "send-email"))
    ).toBe(true);
  });

  it("updates the installed copy when a draft collides on hubId", () => {
    writeSkill(pluginsRoot, "send-email", {
      pluginJson: { hubId: "send-email", name: "Installed", active: false },
    });
    writeSkill(authoredRoot, "send-email", {
      pluginJson: { hubId: "send-email", name: "Draft", active: false },
    });

    // The installed skill is what the list shows, so the admin toggle
    // reaches the installed copy and the draft stays staged.
    const updated = ImportedPlugin.updateImportedPlugin("send-email", {
      active: true,
    });

    expect(updated).toMatchObject({ name: "Installed", active: true });
    expect(
      fs.existsSync(skillFolder(authoredRoot, "send-email"))
    ).toBe(true);
  });

  it("refuses promotion when an orphan installed folder already exists", () => {
    // Installed folder without a plugin.json: not listable, but its
    // directory would collide with the promoted draft.
    const orphan = path.join(pluginsRoot, "send-email");
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(
      path.join(orphan, "handler.js"),
      "module.exports = { runtime: {} };"
    );
    writeSkill(authoredRoot, "send-email", {
      pluginJson: { hubId: "send-email", name: "Draft", active: false },
    });

    expect(() =>
      ImportedPlugin.updateImportedPlugin("send-email", { active: true })
    ).toThrow(/already exists/);
    // The orphan folder is left untouched and the draft stays staged.
    expect(fs.existsSync(path.join(pluginsRoot, "send-email", "handler.js"))).toBe(
      true
    );
    expect(
      fs.existsSync(skillFolder(authoredRoot, "send-email"))
    ).toBe(true);
  });

  it("deletes either installed skills or pending drafts", () => {
    writeSkill(pluginsRoot, "installed-skill");
    writeSkill(authoredRoot, "draft-skill");

    expect(ImportedPlugin.deletePlugin("draft-skill")).toBe(true);
    expect(fs.existsSync(skillFolder(authoredRoot, "draft-skill"))).toBe(
      false
    );
    expect(ImportedPlugin.deletePlugin("installed-skill")).toBe(true);
    expect(fs.existsSync(skillFolder(pluginsRoot, "installed-skill"))).toBe(
      false
    );
    expect(ImportedPlugin.deletePlugin("missing-skill")).toBeUndefined();
  });

  it("keeps installed-skill updates on the upstream behavior", () => {
    writeSkill(pluginsRoot, "installed-skill", {
      pluginJson: { hubId: "installed-skill", active: false },
    });

    const updated = ImportedPlugin.updateImportedPlugin("installed-skill", {
      active: true,
      hubId: "spoofed",
    });

    expect(updated).toMatchObject({
      hubId: "installed-skill",
      active: true,
    });
  });
});
