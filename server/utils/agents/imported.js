const fs = require("fs");
const path = require("path");
const { safeJsonParse } = require("../http");
const { isWithin, normalizePath } = require("../files");
const { CollectorApi } = require("../collectorApi");
const pluginsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../../storage/plugins/agent-skills")
    : path.resolve(process.env.STORAGE_DIR, "plugins", "agent-skills");
// KeplerLLM fork: staging root for agent-authored Custom Skill drafts.
// Drafts live here until a human promotes them through the admin toggle.
// They are never loaded, executed or scheduled from this location.
const authoredPluginsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../../storage/anythingllm-fs/agent-skills")
    : path.resolve(process.env.STORAGE_DIR, "anythingllm-fs", "agent-skills");
const sharedWebScraper = new CollectorApi();

class ImportedPlugin {
  constructor(config) {
    this.config = config;
    this.handlerLocation = path.resolve(
      pluginsPath,
      normalizePath(this.config.hubId),
      "handler.js"
    );
    if (!isWithin(pluginsPath, this.handlerLocation))
      throw new Error("Plugin handler does not pass path validation.");
    delete require.cache[require.resolve(this.handlerLocation)];
    this.handler = require(this.handlerLocation);
    this.name = config.hubId;
    this.startupConfig = {
      params: {},
    };
  }

  /**
   * Gets the imported plugin handler.
   * @param {string} hubId - The hub ID of the plugin.
   * @returns {ImportedPlugin} - The plugin handler.
   */
  static loadPluginByHubId(hubId) {
    const configLocation = path.resolve(
      pluginsPath,
      normalizePath(hubId),
      "plugin.json"
    );
    if (!this.isValidLocation(configLocation)) return;
    const config = safeJsonParse(fs.readFileSync(configLocation, "utf8"));
    return new ImportedPlugin(config);
  }

  static isValidLocation(pathToValidate, rootPath = pluginsPath) {
    if (!isWithin(rootPath, pathToValidate)) return false;
    if (!fs.existsSync(pathToValidate)) return false;
    return true;
  }

  /**
   * Checks if the plugin folders exist and if they do not, creates them.
   * Both the administrative root and the KeplerLLM draft staging root
   * are created automatically when first needed.
   */
  static checkPluginFolderExists() {
    for (const dir of [pluginsPath, authoredPluginsPath]) {
      const resolvedDir = path.resolve(dir);
      if (!fs.existsSync(resolvedDir))
        fs.mkdirSync(resolvedDir, { recursive: true });
    }
    return;
  }

  /**
   * Loads plugins from `plugins` folder in storage that are custom loaded and defined.
   * only loads plugins that are active: true.
   * @returns {string[]} - array of plugin names to be loaded later.
   */
  static activeImportedPlugins() {
    const plugins = [];
    this.checkPluginFolderExists();
    const folders = fs.readdirSync(path.resolve(pluginsPath));
    for (const folder of folders) {
      const configLocation = path.resolve(
        pluginsPath,
        normalizePath(folder),
        "plugin.json"
      );
      if (!this.isValidLocation(configLocation)) continue;
      const config = safeJsonParse(fs.readFileSync(configLocation, "utf8"));
      if (config.active) plugins.push(`@@${config.hubId}`);
    }
    return plugins;
  }

  /**
   * Lists all imported plugins.
   * Installed administrative skills are listed first, followed by
   * KeplerLLM agent-authored drafts staged for human review. Drafts are
   * always reported inactive with a pending-review marker, even when
   * their plugin.json claims to be active. On hubId collisions the
   * installed skill wins. Folders without a parseable plugin.json
   * identity are ignored.
   * @returns {Array} - array of plugin configurations (JSON).
   */
  static listImportedPlugins() {
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

    appendPluginsFrom(pluginsPath);
    appendPluginsFrom(authoredPluginsPath, true);
    return plugins;
  }

  /**
   * Updates a plugin configuration.
   * Installed skills keep the upstream behavior. KeplerLLM drafts stay
   * inactive on plain edits: writing active:true into a draft file never
   * makes it executable. Only an explicit activation through the admin
   * Custom Skill toggle promotes the draft into the executable root, and
   * promotion fails instead of overwriting when the folder identity
   * mismatches plugin.json, when handler.js is missing, or when an
   * installed skill with the same identity already exists.
   * @param {string} hubId - The hub ID of the plugin.
   * @param {object} config - The configuration to update.
   * @returns {object} - The updated configuration.
   */
  static updateImportedPlugin(hubId, config) {
    // Both skill directories exist from here on, including the executable
    // root when a draft is promoted into it for the first time.
    this.checkPluginFolderExists();
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

    // API-supplied identity and review markers can never escalate a draft.
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
        `Agent-authored skill hubId mismatch: folder '${hubId}' contains '${currentConfig.hubId}'.`
      );
    }

    const authoredFolder = path.dirname(authoredConfigLocation);
    const authoredHandler = path.resolve(authoredFolder, "handler.js");
    if (!this.isValidLocation(authoredHandler, authoredPluginsPath)) {
      throw new Error(
        `Agent-authored skill '${hubId}' cannot be promoted without handler.js.`
      );
    }

    const targetFolder = path.resolve(pluginsPath, normalizedHubId);
    if (!isWithin(pluginsPath, targetFolder)) {
      throw new Error(`Invalid agent-authored skill path for '${hubId}'.`);
    }
    if (fs.existsSync(targetFolder)) {
      throw new Error(
        `Cannot promote agent-authored skill '${hubId}': an administrative skill with the same hubId already exists.`
      );
    }

    updatedConfig.active = true;
    fs.writeFileSync(
      authoredConfigLocation,
      JSON.stringify(updatedConfig, null, 2)
    );
    fs.renameSync(authoredFolder, targetFolder);
    return updatedConfig;
  }

  /**
   * Deletes a plugin. Removes the entire folder of the object.
   * Works for either an installed skill or a KeplerLLM pending draft.
   * @param {string} hubId - The hub ID of the plugin.
   * @returns {boolean} - True if the plugin was deleted, false otherwise.
   */
  static deletePlugin(hubId) {
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
  }

  /**
  /**
   * Validates if the handler.js file exists for the given plugin.
   * @param {string} hubId - The hub ID of the plugin.
   * @returns {boolean} - True if the handler.js file exists, false otherwise.
   */
  static validateImportedPluginHandler(hubId) {
    const handlerLocation = path.resolve(
      pluginsPath,
      normalizePath(hubId),
      "handler.js"
    );
    return this.isValidLocation(handlerLocation);
  }

  /**
   * Creates a requestToolApproval function bound to a specific aibitat
   * instance and skill name via closure — no `this` binding required.
   *
   * The returned function pauses the agent and asks the user to approve a
   * potentially destructive action before the skill performs it.
   *
   * `skillName` is captured from the skill's hubId so a skill cannot spoof
   * another tool's name to bypass its own approval.
   *
   * When no approval channel exists (e.g. scheduled jobs) it resolves
   * approved so the skill still runs, matching how built-in tools fall
   * through their approval guard.
   *
   * @param {object} aibitat - The aibitat instance.
   * @param {string} skillName - The skill's hubId.
   * @returns {function({payload?: object, description?: string}): Promise<{approved: boolean, message: string}>}
   */
  static createToolApprovalFn(aibitat, skillName) {
    return async function requestToolApproval({
      payload = {},
      description = null,
    } = {}) {
      if (typeof aibitat?.requestToolApproval !== "function") {
        return {
          approved: true,
          message: "Approval not required in this context.",
        };
      }
      return aibitat.requestToolApproval({
        skillName,
        payload,
        description,
      });
    };
  }

  parseCallOptions() {
    const callOpts = {};
    if (!this.config.setup_args || typeof this.config.setup_args !== "object") {
      return callOpts;
    }
    for (const [param, definition] of Object.entries(this.config.setup_args)) {
      if (definition.required && !definition?.value) {
        console.log(
          `'${param}' required value for '${this.name}' plugin is missing. Plugin may not function or crash agent.`
        );
        continue;
      }
      callOpts[param] = definition.value || definition.default || null;
    }
    return callOpts;
  }

  plugin(runtimeArgs = {}) {
    const customFunctions = this.handler.runtime;
    return {
      runtimeArgs,
      name: this.name,
      config: this.config,
      setup(aibitat) {
        aibitat.function({
          super: aibitat,
          name: this.name,
          config: this.config,
          runtimeArgs: this.runtimeArgs,
          description: this.config.description,
          logger: aibitat?.handlerProps?.log || console.log,
          introspect: aibitat?.introspect || console.log,
          runtime: "docker",
          webScraper: sharedWebScraper,
          examples: this.config.examples ?? [],
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: this.config.entrypoint.params ?? {},
            additionalProperties: false,
          },
          ...customFunctions,

          // Add the requestToolApproval function to the plugin
          // but do not allow the skill's own handler.js exports to override it.
          // because it requires an explict shape to return elements to the UI.
          requestToolApproval: ImportedPlugin.createToolApprovalFn(
            aibitat,
            this.config.name
          ),
        });
      },
    };
  }

  /**
   * Imports a community item from a URL.
   * The community item is a zip file that contains a plugin.json file and handler.js file.
   * This function will unzip the file and import the plugin into the agent-skills folder
   * based on the hubId found in the plugin.json file.
   * The zip file will be downloaded to the pluginsPath folder and then unzipped and finally deleted.
   * @param {string} url - The signed URL of the community item zip file.
   * @param {object} item - The community item.
   * @returns {Promise<object>} - The result of the import.
   */
  static async importCommunityItemFromUrl(url, item) {
    this.checkPluginFolderExists();
    const hubId = item.id;
    if (!hubId) return { success: false, error: "No hubId passed to import." };

    const zipFilePath = path.resolve(pluginsPath, `${item.id}.zip`);
    const pluginFile = item.manifest.files.find(
      (file) => file.name === "plugin.json"
    );
    if (!pluginFile)
      return {
        success: false,
        error: "No plugin.json file found in manifest.",
      };

    const pluginFolder = path.resolve(pluginsPath, normalizePath(hubId));
    if (fs.existsSync(pluginFolder))
      console.log(
        "ImportedPlugin.importCommunityItemFromUrl - plugin folder already exists - will overwrite"
      );

    try {
      const protocol = new URL(url).protocol.replace(":", "");
      const httpLib = protocol === "https" ? require("https") : require("http");

      const downloadZipFile = new Promise(async (resolve) => {
        try {
          console.log(
            "ImportedPlugin.importCommunityItemFromUrl - downloading asset from ",
            new URL(url).origin
          );
          const zipFile = fs.createWriteStream(zipFilePath);
          const request = httpLib.get(url, function (response) {
            response.pipe(zipFile);
            zipFile.on("finish", () => {
              console.log(
                "ImportedPlugin.importCommunityItemFromUrl - downloaded zip file"
              );
              resolve(true);
            });
          });

          request.on("error", (error) => {
            console.error(
              "ImportedPlugin.importCommunityItemFromUrl - error downloading zip file: ",
              error
            );
            resolve(false);
          });
        } catch (error) {
          console.error(
            "ImportedPlugin.importCommunityItemFromUrl - error downloading zip file: ",
            error
          );
          resolve(false);
        }
      });

      const success = await downloadZipFile;
      if (!success)
        return { success: false, error: "Failed to download zip file." };

      // Unzip the file to the plugin folder
      // Note: https://github.com/cthackers/adm-zip?tab=readme-ov-file#electron-original-fs
      const AdmZip = require("adm-zip");
      const zip = new AdmZip(zipFilePath);

      // Validate all zip entries to prevent Zip Slip path traversal attacks (CWE-22)
      for (const entry of zip.getEntries()) {
        const entryPath = path.resolve(pluginFolder, entry.entryName);
        if (!isWithin(pluginFolder, entryPath) && pluginFolder !== entryPath) {
          throw new Error(
            `[ImportedPlugin.importCommunityItemFromUrl]: Entry "${entry.entryName}" would extract outside plugin folder - not allowed.`
          );
        }
      }

      zip.extractAllTo(pluginFolder);

      // We want to make sure specific keys are set to the proper values for
      // plugin.json so we read and overwrite the file with the proper values.
      const pluginJsonPath = path.resolve(pluginFolder, "plugin.json");
      const pluginJson = safeJsonParse(fs.readFileSync(pluginJsonPath, "utf8"));
      pluginJson.active = false;
      pluginJson.hubId = hubId;
      fs.writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2));

      console.log(
        `ImportedPlugin.importCommunityItemFromUrl - successfully imported plugin to agent-skills/${hubId}`
      );
      return { success: true, error: null };
    } catch (error) {
      console.error(
        "ImportedPlugin.importCommunityItemFromUrl - error: ",
        error
      );
      return { success: false, error: error.message };
    } finally {
      if (fs.existsSync(zipFilePath)) fs.unlinkSync(zipFilePath);
    }
  }
}

module.exports = ImportedPlugin;
