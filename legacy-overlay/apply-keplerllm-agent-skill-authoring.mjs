import fs from "node:fs";

function replaceExactlyOnce(text, needle, replacement, label) {
  const occurrences = text.split(needle).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${label}: expected exactly one match, found ${occurrences}. Upstream changed; review the KeplerLLM agent-skill authoring patch.`
    );
  }
  return text.replace(needle, replacement);
}

const importedPluginPath = "/src/server/utils/agents/imported.js";
const scheduledJobPath = "/src/server/models/scheduledJob.js";
const importedSkillListPath =
  "/src/frontend/src/pages/Admin/Agents/Imported/SkillList/index.jsx";

let importedPlugin = fs.readFileSync(importedPluginPath, "utf8");

const pathDefinitions = `const pluginsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../../storage/plugins/agent-skills")
    : path.resolve(process.env.STORAGE_DIR, "plugins", "agent-skills");`;
const keplerllmPathDefinitions = `${pathDefinitions}
const authoredPluginsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../../storage/anythingllm-fs/agent-skills")
    : path.resolve(process.env.STORAGE_DIR, "anythingllm-fs", "agent-skills");`;
importedPlugin = replaceExactlyOnce(
  importedPlugin,
  pathDefinitions,
  keplerllmPathDefinitions,
  "ImportedPlugin paths"
);

const isValidLocation = `  static isValidLocation(pathToValidate) {
    if (!isWithin(pluginsPath, pathToValidate)) return false;
    if (!fs.existsSync(pathToValidate)) return false;
    return true;
  }`;
const keplerllmIsValidLocation = `  static isValidLocation(pathToValidate, rootPath = pluginsPath) {
    if (!isWithin(rootPath, pathToValidate)) return false;
    if (!fs.existsSync(pathToValidate)) return false;
    return true;
  }`;
importedPlugin = replaceExactlyOnce(
  importedPlugin,
  isValidLocation,
  keplerllmIsValidLocation,
  "ImportedPlugin.isValidLocation"
);

const checkPluginFolderExists = `  static checkPluginFolderExists() {
    const dir = path.resolve(pluginsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return;
  }`;
const keplerllmCheckPluginFolderExists = `  static checkPluginFolderExists() {
    for (const dir of [pluginsPath, authoredPluginsPath]) {
      const resolvedDir = path.resolve(dir);
      if (!fs.existsSync(resolvedDir)) fs.mkdirSync(resolvedDir, { recursive: true });
    }
    return;
  }`;
importedPlugin = replaceExactlyOnce(
  importedPlugin,
  checkPluginFolderExists,
  keplerllmCheckPluginFolderExists,
  "ImportedPlugin.checkPluginFolderExists"
);

const listImportedPlugins = `  static listImportedPlugins() {
    const plugins = [];
    this.checkPluginFolderExists();
    if (!fs.existsSync(pluginsPath)) return plugins;

    const folders = fs.readdirSync(path.resolve(pluginsPath));
    for (const folder of folders) {
      const configLocation = path.resolve(
        pluginsPath,
        normalizePath(folder),
        "plugin.json"
      );
      if (!this.isValidLocation(configLocation)) continue;
      const config = safeJsonParse(fs.readFileSync(configLocation, "utf8"));
      plugins.push(config);
    }
    return plugins;
  }`;
const keplerllmListImportedPlugins = `  static listImportedPlugins() {
    const plugins = [];
    const seenHubIds = new Set();
    this.checkPluginFolderExists();

    const appendPluginsFrom = (rootPath, pendingReview = false) => {
      if (!fs.existsSync(rootPath)) return;
      const folders = fs.readdirSync(path.resolve(rootPath));
      for (const folder of folders) {
        const configLocation = path.resolve(
          rootPath,
          normalizePath(folder),
          "plugin.json"
        );
        if (!this.isValidLocation(configLocation, rootPath)) continue;
        const config = safeJsonParse(
          fs.readFileSync(configLocation, "utf8"),
          null
        );
        if (!config?.hubId || seenHubIds.has(config.hubId)) continue;
        seenHubIds.add(config.hubId);
        plugins.push(
          pendingReview
            ? {
                ...config,
                active: false,
                keplerllmPendingReview: true,
                keplerllmSource: "agent-authored",
              }
            : config
        );
      }
    };

    // Administrative/imported skills always win on hubId collisions.
    appendPluginsFrom(pluginsPath);
    appendPluginsFrom(authoredPluginsPath, true);
    return plugins;
  }`;
importedPlugin = replaceExactlyOnce(
  importedPlugin,
  listImportedPlugins,
  keplerllmListImportedPlugins,
  "ImportedPlugin.listImportedPlugins"
);

const updateImportedPlugin = `  static updateImportedPlugin(hubId, config) {
    const configLocation = path.resolve(
      pluginsPath,
      normalizePath(hubId),
      "plugin.json"
    );
    if (!this.isValidLocation(configLocation)) return;

    const currentConfig = safeJsonParse(
      fs.readFileSync(configLocation, "utf8"),
      null
    );
    if (!currentConfig) return;

    const { hubId: _drop, ...safeConfig } = config;
    const updatedConfig = { ...currentConfig, ...safeConfig };
    fs.writeFileSync(configLocation, JSON.stringify(updatedConfig, null, 2));
    return updatedConfig;
  }`;
const keplerllmUpdateImportedPlugin = `  static updateImportedPlugin(hubId, config) {
    const normalizedHubId = normalizePath(hubId);
    const primaryConfigLocation = path.resolve(
      pluginsPath,
      normalizedHubId,
      "plugin.json"
    );
    const authoredConfigLocation = path.resolve(
      authoredPluginsPath,
      normalizedHubId,
      "plugin.json"
    );

    const isPrimary = this.isValidLocation(primaryConfigLocation, pluginsPath);
    const isAuthored = this.isValidLocation(
      authoredConfigLocation,
      authoredPluginsPath
    );
    if (!isPrimary && !isAuthored) return;

    const configLocation = isPrimary
      ? primaryConfigLocation
      : authoredConfigLocation;
    const currentConfig = safeJsonParse(
      fs.readFileSync(configLocation, "utf8"),
      null
    );
    if (!currentConfig) return;

    const {
      hubId: _dropHubId,
      keplerllmPendingReview: _dropPendingReview,
      keplerllmSource: _dropSource,
      ...safeConfig
    } = config;

    if (isPrimary) {
      const updatedConfig = { ...currentConfig, ...safeConfig };
      fs.writeFileSync(configLocation, JSON.stringify(updatedConfig, null, 2));
      return updatedConfig;
    }

    // Agent-authored skills are drafts. Merely writing active:true into their
    // plugin.json does not make them executable. Only an admin/API toggle that
    // reaches this method can promote the draft into the administrative root.
    const wantsActivation = safeConfig.active === true;
    const updatedConfig = {
      ...currentConfig,
      ...safeConfig,
      hubId,
      active: false,
    };

    if (!wantsActivation) {
      fs.writeFileSync(configLocation, JSON.stringify(updatedConfig, null, 2));
      return {
        ...updatedConfig,
        keplerllmPendingReview: true,
        keplerllmSource: "agent-authored",
      };
    }

    if (currentConfig.hubId !== hubId) {
      throw new Error(
        "Agent-authored skill hubId mismatch: folder '" +
          hubId +
          "' contains '" +
          currentConfig.hubId +
          "'."
      );
    }

    const authoredFolder = path.dirname(authoredConfigLocation);
    const authoredHandler = path.resolve(authoredFolder, "handler.js");
    if (!this.isValidLocation(authoredHandler, authoredPluginsPath)) {
      throw new Error(
        "Agent-authored skill '" + hubId + "' cannot be promoted without handler.js."
      );
    }

    const targetFolder = path.resolve(pluginsPath, normalizedHubId);
    if (!isWithin(pluginsPath, targetFolder)) {
      throw new Error(
        "Invalid agent-authored skill path for '" + hubId + "'."
      );
    }
    if (fs.existsSync(targetFolder)) {
      throw new Error(
        "Cannot promote agent-authored skill '" +
          hubId +
          "': an administrative skill with the same hubId already exists."
      );
    }

    updatedConfig.active = true;
    fs.writeFileSync(
      authoredConfigLocation,
      JSON.stringify(updatedConfig, null, 2)
    );
    fs.renameSync(authoredFolder, targetFolder);
    return updatedConfig;
  }`;
importedPlugin = replaceExactlyOnce(
  importedPlugin,
  updateImportedPlugin,
  keplerllmUpdateImportedPlugin,
  "ImportedPlugin.updateImportedPlugin"
);

const deletePlugin = `  static deletePlugin(hubId) {
    if (!hubId) throw new Error("No plugin hubID passed.");
    const pluginFolder = path.resolve(pluginsPath, normalizePath(hubId));
    if (!this.isValidLocation(pluginFolder)) return;
    fs.rmSync(pluginFolder, { recursive: true });
    return true;
  }`;
const keplerllmDeletePlugin = `  static deletePlugin(hubId) {
    if (!hubId) throw new Error("No plugin hubID passed.");
    const normalizedHubId = normalizePath(hubId);
    const candidates = [
      [pluginsPath, path.resolve(pluginsPath, normalizedHubId)],
      [authoredPluginsPath, path.resolve(authoredPluginsPath, normalizedHubId)],
    ];

    for (const [rootPath, pluginFolder] of candidates) {
      if (!this.isValidLocation(pluginFolder, rootPath)) continue;
      fs.rmSync(pluginFolder, { recursive: true });
      return true;
    }
    return;
  }`;
importedPlugin = replaceExactlyOnce(
  importedPlugin,
  deletePlugin,
  keplerllmDeletePlugin,
  "ImportedPlugin.deletePlugin"
);

fs.writeFileSync(importedPluginPath, importedPlugin);

let scheduledJob = fs.readFileSync(scheduledJobPath, "utf8");
const scheduledImportedPlugins =
  "    const importedPlugins = ImportedPlugin.listImportedPlugins();";
const keplerllmScheduledImportedPlugins = `    const importedPlugins = ImportedPlugin.listImportedPlugins().filter(
      (plugin) => !plugin.keplerllmPendingReview
    );`;
scheduledJob = replaceExactlyOnce(
  scheduledJob,
  scheduledImportedPlugins,
  keplerllmScheduledImportedPlugins,
  "ScheduledJob custom skills"
);
fs.writeFileSync(scheduledJobPath, scheduledJob);

let importedSkillList = fs.readFileSync(importedSkillListPath, "utf8");
const importedSkillStatus = '{config.active ? "On" : "Off"}';
const keplerllmImportedSkillStatus = `{config.keplerllmPendingReview && !config.active
                ? "Pending review"
                : config.active
                  ? "On"
                  : "Off"}`;
importedSkillList = replaceExactlyOnce(
  importedSkillList,
  importedSkillStatus,
  keplerllmImportedSkillStatus,
  "ImportedSkillList status"
);
fs.writeFileSync(importedSkillListPath, importedSkillList);

console.log(
  "Applied KeplerLLM agent-authored Custom Skill staging and approval patch."
);
