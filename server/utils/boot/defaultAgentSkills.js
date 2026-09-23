// KeplerLLM fork: bootstrap the opt-in AnythingLLM Agent Skills from an
// environment variable. Bootstrap-only semantics: the environment value is
// used to create the `default_agent_skills` system setting when no such row
// exists yet. The database remains the source of truth afterwards, so
// restarts never overwrite UI/API changes.
//
// Supported variable:
//   DEFAULT_AGENT_SKILLS
//
// Example:
//   DEFAULT_AGENT_SKILLS=filesystem-agent,create-files-agent,create-chart,web-browsing,sql-agent,create-scheduled-job
//
// Rules:
// - Unset: preserve upstream behavior exactly; no row is created or modified.
// - Empty string: intentional configuration; bootstraps an empty list (no
//   opt-in skills enabled initially).
// - Existing `default_agent_skills` row: never overwritten, even when the
//   environment value differs.
// - Invalid identifiers fail startup clearly before anything is persisted.
// - This module contains no SQLite/PostgreSQL-specific code and issues no raw
//   SQL. All persistence goes through the existing SystemSettings model layer.

const ENV_KEY = "DEFAULT_AGENT_SKILLS";
const SETTING_LABEL = "default_agent_skills";

// KeplerLLM fork: explicit canonical server-side list of the user-facing
// opt-in Agent Skills shown by the Agent Skills UI at the AnythingLLM 1.16.1
// baseline (see frontend/src/pages/Admin/Agents/skills.jsx
// getConfigurableSkills). An explicit list is used instead of deriving from
// AgentPlugins so internal/non-user-facing plugins (websocket, chat-history,
// memory, request-user-input, model-router-cooldown), the default-enabled
// skills governed by disabled_agent_skills (rag-memory, document-summarizer,
// web-scraping), and app-integration skills with their own setup surface
// (gmail-agent, google-calendar-agent, outlook-agent) can never be enabled
// through this variable. Imported Custom Skills, Agent Flows, and MCP servers
// are also out of scope and never accepted here.
const ACCEPTED_AGENT_SKILLS = [
  "filesystem-agent",
  "create-files-agent",
  "create-chart",
  "web-browsing",
  "sql-agent",
  "create-scheduled-job",
];

const ACCEPTED_SET = new Set(ACCEPTED_AGENT_SKILLS);

function isEnabled(env = process.env) {
  return env[ENV_KEY] !== undefined;
}

function fail(message) {
  throw new Error(`[KeplerLLM] ${message}`);
}

/**
 * Parse and validate DEFAULT_AGENT_SKILLS.
 * Unset returns { enabled: false } so callers preserve upstream behavior.
 * An explicitly empty string returns { enabled: true, skills: [] }.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{enabled:boolean, skills?:string[]}}
 */
function parseDefaultAgentSkills(env = process.env) {
  if (!isEnabled(env)) return { enabled: false };

  const raw = env[ENV_KEY];
  const text = typeof raw === "string" ? raw : String(raw ?? "");

  const skills = [];
  const seen = new Set();
  for (const part of text.split(",")) {
    const skill = part.trim();
    if (skill === "") continue;
    if (seen.has(skill)) continue;
    seen.add(skill);
    skills.push(skill);
  }

  for (const skill of skills) {
    if (!ACCEPTED_SET.has(skill)) {
      fail(
        `${ENV_KEY} contains invalid skill identifier "${skill}". Accepted values: ${ACCEPTED_AGENT_SKILLS.join(", ")}.`
      );
    }
  }

  return { enabled: true, skills };
}

function safeSummary(skills) {
  if (!skills || skills.length === 0) return "skills=none count=0";
  return `skills=${skills.join(",")} count=${skills.length}`;
}

/**
 * Bootstrap default_agent_skills once. Idempotent: when the setting row
 * already exists the database is treated as the source of truth and no
 * values are overwritten. The existence of the
 * system_settings.label = "default_agent_skills" row is itself the
 * initialized marker, so no extra bootstrap marker is used.
 * @param {{env?:NodeJS.ProcessEnv, SystemSettingsModel?:Object, logger?:Object}} [options]
 */
async function bootstrapDefaultAgentSkills({
  env = process.env,
  SystemSettingsModel = null,
  logger = console,
} = {}) {
  if (!isEnabled(env)) return { bootstrapped: false, reason: "disabled" };

  const Settings =
    SystemSettingsModel ||
    require("../../models/systemSettings").SystemSettings;

  const existing = await Settings.get({ label: SETTING_LABEL });
  if (existing) {
    logger.log(
      `[KeplerLLM] Default agent skills bootstrap skipped (already exists) ${safeSummary(parseStoredSkills(existing.value))}`
    );
    return { bootstrapped: true, created: false, setting: existing };
  }

  // Parse before any persistence so an invalid identifier fails fast without
  // partially persisting a list.
  const parsed = parseDefaultAgentSkills(env);

  // Persist through the existing model validation path (comma-joined string
  // becomes the stored JSON array). Identical on SQLite and PostgreSQL.
  const result = await Settings.updateSettings({
    [SETTING_LABEL]: parsed.skills.join(","),
  });
  if (result && result.success === false) {
    fail(
      `Failed to bootstrap ${ENV_KEY} (${SETTING_LABEL}): ${result.error || "unknown error"}`
    );
  }

  const stored = await Settings.get({ label: SETTING_LABEL });
  logger.log(
    `[KeplerLLM] Default agent skills bootstrap enabled (created) ${safeSummary(parsed.skills)}`
  );
  return { bootstrapped: true, created: true, setting: stored };
}

function parseStoredSkills(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
    return [];
  } catch {
    return [];
  }
}

module.exports = {
  ENV_KEY,
  SETTING_LABEL,
  ACCEPTED_AGENT_SKILLS,
  isEnabled,
  parseDefaultAgentSkills,
  bootstrapDefaultAgentSkills,
};
