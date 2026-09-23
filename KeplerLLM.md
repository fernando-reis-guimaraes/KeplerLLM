# KeplerLLM

> Canonical specification in English (US). Portuguese version: [KeplerLLM.pt-BR.md](KeplerLLM.pt-BR.md).

KeplerLLM is a fork of AnythingLLM. It preserves upstream behavior except for the fork changes defined below.

The fork adds persistent UI configuration with a single storage volume, a product model label, alphabetical OpenAI model ordering, agent-authored Custom Skill staging with human approval, dynamic SQLite/PostgreSQL backend selection from a single Docker image, an optional OpenAI-compatible Responses API mode for the Generic OpenAI provider, remote MCP server configuration through environment variables, default workspace bootstrap from environment variables, default Agent Skills bootstrap from an environment variable, and optional UI-only hiding of Settings entry buttons.

## Fork changes

This section defines the fork delta. Each requirement describes observable behavior. It does not prescribe implementation.

### Requirement 1 - Persistent UI configuration

#### Objective

Keep configuration managed through the AnythingLLM UI across restarts and redeploys with only the standard storage volume.

#### Observable behavior

- The deployment mounts only the standard storage volume at `/app/server/storage`.
- UI-managed configuration persists at `${STORAGE_DIR}/.env` and remains available to the server as `/app/server/.env`.
- On first boot, when no persistent configuration exists, the server starts from the default configuration shipped in the image.
- Changes made through the AnythingLLM UI persist across restarts.
- The storage directory is created when missing.
- Startup fails with a clear error when the persistent configuration is not writable.

#### Rules and limits

- Seeding from the image default happens only when the persistent file does not exist.
- No separate file mount or bind mount is required for UI configuration.

#### Out of scope

- Versioning, merging, or migrating configuration values.
- Persistence for files outside the standard storage volume.

### Requirement 2 - Product model label

#### Objective

Show a product label instead of the underlying model identifier where the workspace model picker is visible.

#### Observable behavior

- The workspace model picker shows a KeplerLLM label instead of the raw provider or model identifier.
- The default label is:

```text
Kepler AI
```

- Operators can override the label at runtime with:

```text
KEPLERLLM_MODEL_DISPLAY_NAME=Your Name Here
```

- The configured label is available on every boot without rebuilding the image.
- An empty or whitespace-only override falls back to upstream model-name resolution.
- The label applies where the picker is visible, such as single-user mode and admin sessions. Non-admin visibility in multi-user mode remains governed by upstream behavior.

#### Rules and limits

- Display-only change. Provider selection, model selection, API requests, and billing behavior remain unchanged.

#### Out of scope

- Renaming providers, models, or router entries in settings or APIs.
- Hiding or changing which models a workspace may select.

### Requirement 3 - Alphabetical OpenAI model ordering

#### Objective

Make related OpenAI snapshots easy to find by keeping organization grouping and sorting models alphabetically inside each group.

#### Observable behavior

- OpenAI models remain grouped by organization.
- Models inside each organization group appear in alphabetical order by model name.
- For example, snapshots such as:

```text
gpt-4o-2024-05-13
gpt-4o-2024-08-06
gpt-4o-2024-11-20
```

appear together in lexical order instead of inheriting API response order.

#### Rules and limits

- Display-only change. Model IDs, provider behavior, API requests, and the selected model remain unchanged.

#### Out of scope

- Sorting models from other providers.
- Changing organization grouping or default selection.

### Requirement 4 - Agent-authored Custom Skill staging

#### Objective

Let the agent author Custom Skill drafts without granting it write access to installed executable skills. A human approves drafts before execution.

The lifecycle is:

```text
WRITE -> REVIEW -> EXECUTE
```

rather than:

```text
WRITE -> EXECUTE
```

#### Observable behavior

- File System Access remains confined to:

```text
${STORAGE_DIR}/anythingllm-fs
```

- Agent-authored drafts live in:

```text
${STORAGE_DIR}/anythingllm-fs/agent-skills/<hubId>
```

- A draft uses the normal AnythingLLM Custom Skill layout:

```text
anythingllm-fs/agent-skills/send-email/
├── plugin.json
├── handler.js
└── README.md
```

- Installed executable skills remain in:

```text
${STORAGE_DIR}/plugins/agent-skills
```

- The skill list shows both installed skills and drafts. Drafts appear with status `Pending review`.
- A draft is always reported as inactive, even when its `plugin.json` contains `"active": true`.
- Drafts are not loadable by the agent runtime and are excluded from Scheduled Job tool selection.
- Enabling a draft through the admin Custom Skill toggle promotes it into the executable directory and sets it active.
- After promotion, File System Access can no longer modify the skill.
- Deleting a skill works for either an installed skill or a pending draft.

#### Rules and limits

- Promotion happens only through explicit activation in the admin Custom Skill toggle. Writing `active: true` into a draft file does not make it executable.
- Editing a draft without activating it keeps it inactive and preserves the folder identity.
- API-supplied identity and review markers cannot escalate a draft.
- Promotion fails instead of overwriting when the folder identity mismatches `plugin.json`, when `handler.js` is missing, or when an installed skill with the same identity already exists.
- When the same identity exists in both locations, the installed copy wins.
- Folders without a parseable `plugin.json` identity are ignored.
- Community Hub imports remain immediately administrative and do not pass through draft review.
- Both skill directories are created automatically when first needed.

#### Out of scope

- Automatic review, testing, or sandboxing of drafts.
- Version history or rollback for promoted skills.
- Changing upstream Custom Skill execution semantics after promotion.

#### Authoring workflow

1. Enable **Agent Skills -> File System Access**.
2. Enable the file operations required for authoring, typically directory creation, writing, editing, reading, and listing.
3. Ask the agent to create the skill under `agent-skills/<hubId>` inside its File System Access root.
4. Review the generated `plugin.json`, `handler.js`, and supporting files.
5. Open **Settings -> Agent Skills -> Custom Skills**.
6. The draft appears as **Pending review**.
7. Enable it to promote it into the executable Custom Skill directory.

Example request:

```text
Create a Custom Agent Skill named send-email under agent-skills/send-email.
Use the standard AnythingLLM plugin.json + handler.js layout.
Do not put credentials in source files.
Leave the skill inactive for review.
```

### Requirement 5 - Product name in user-visible text

#### Objective

Present KeplerLLM as the product name everywhere the user can see it, while keeping every technical contract identical to upstream.

#### Observable behavior

- UI strings, titles, descriptions, help texts, notification defaults, the browser tab title, and the PWA manifest show KeplerLLM instead of AnythingLLM.
- Generated artifacts carry KeplerLLM branding (exported chats, office documents, chat widget defaults).
- Bot messages and developer API documentation are titled KeplerLLM.
- External product links point at KeplerLLM properties: the GitHub icon links to `https://github.com/ultra-mega-apps`, docs and support pages link to `https://ultra-mega-apps.com`, the Discord invite is replaced by WhatsApp at `https://wa.me/13025505015`, and the default support email is `support@ultra-mega-apps.com`. The onboarding survey endpoint no longer reports to upstream.
- Logo wordmarks show KeplerLLM instead of AnythingLLM. The infinity icon pixels are preserved. `Kepler` keeps the original wordmark color (white `#FFFFFF` on dark backgrounds, dark `#222628` on light backgrounds) and `LLM` uses blue `#2E90FA`. Canvas size, proportions, transparency, and layout are unchanged.

#### Rules and limits

- Text-only change. Package names, imports, identifiers, file paths, storage keys, localStorage keys, API routes, request/response contracts, provider slugs (including `anythingllm-router`), and integration header tokens remain unchanged. Functional upstream service endpoints stay on their original URLs.
- Functional service integrations keep working: model downloads from the upstream CDN, Community Hub imports and profile links, and the Docker Chromium download stay on upstream endpoints.
- Logo filenames, file paths, canvas sizes, transparency, and infinity icon pixels remain unchanged for upstream compatibility; only wordmark text pixels changed to KeplerLLM (`Kepler` in `#FFFFFF` or `#222628`, `LLM` in `#2E90FA`, Plus Jakarta Sans). Icon-only assets (`anything-llm-icon.png`, `anything-llm-infinity.png`, favicons) are unchanged. `frontend/dist/` logos are generated build output and regenerate on build.
- Rebranded wordmark files: `frontend/src/media/logo/anything-llm.png`, `frontend/src/media/logo/anything-llm-dark.png`, `frontend/public/anything-llm-light.png`, `frontend/public/anything-llm-dark.png`, `server/storage/assets/anything-llm.png`, `server/storage/assets/anything-llm-invert.png`, `server/utils/agents/aibitat/plugins/create-files/assets/anything-llm.png`, `server/utils/agents/aibitat/plugins/create-files/assets/anything-llm-invert.png`, `open-computer/services/public/anythingllm-wordmark.png`, plus submodule files `embed/src/assets/anything-llm-dark.png` and `browser-extension/src/media/anything-llm.png`. Upgrade note: upstream logo updates will conflict; re-apply the KeplerLLM wordmark rendering when merging.
- The embed widget and the browser extension live in forked repositories (`frginbox/KeplerLLM_Embed`, `frginbox/KeplerLLM_Browser-Extension`, with personal forks under `fernando-reis-guimaraes/`), wired as git submodules. Their committed widget build under `frontend/public/embed/` is regenerated from the forked embed source.
- There are no product email templates in the codebase; the rule applies to bot and notification messages instead.

#### Out of scope

- Renaming upstream services, repositories, or documentation URLs.
- Changing Community Hub imports, which remain administrative.

### Requirement 6 - Dynamic database backend selection

#### Objective

Run the same KeplerLLM Docker image with either SQLite or PostgreSQL, selecting the backend at container startup.

#### Observable behavior

- When `DATABASE_URL` is unset or empty, KeplerLLM uses SQLite at:

```text
/app/server/storage/anythingllm.db
```

Existing SQLite behavior and data location are unchanged.

- When `DATABASE_URL` is set to `postgresql://...` or `postgres://...`, KeplerLLM uses PostgreSQL through `DATABASE_URL`.
- Neon is a compatible standard PostgreSQL provider. The implementation is generic PostgreSQL and is not Neon-specific. Example:

```text
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
```

- Startup logs one of:

```text
Database backend: SQLite
Database backend: PostgreSQL
```

The full `DATABASE_URL` value and its password are never logged.

- If `DATABASE_URL` is set but does not use a PostgreSQL URI scheme, startup fails fast before the application starts and does not fall back to SQLite.
- `STORAGE_DIR` remains required even with PostgreSQL because KeplerLLM stores non-database files there.
- Migrations run with `prisma migrate deploy`, not `prisma db push`. SQLite uses `server/prisma/schema.prisma` and `server/prisma/migrations/`. PostgreSQL uses `server/prisma/postgresql/schema.prisma` and `server/prisma/postgresql/migrations/`.
- Adding `DATABASE_URL` selects the PostgreSQL backend; it does not copy data from an existing SQLite database. Removing `DATABASE_URL` later selects the previous SQLite database again if it still exists. There is no automatic data migration between backends.

#### Rules and limits

- SQLite remains the default. Users without `DATABASE_URL` observe no behavioral or data-location change.
- There is a single Docker image and tag stream. There is no separate `:pg` KeplerLLM image.
- Backend selection happens at container startup in `docker/docker-entrypoint.sh` before Prisma generate and migrate.
- `server/prisma/schema.prisma` and `server/prisma/postgresql/schema.prisma` must stay model-compatible. Only the datasource provider and provider-specific header comments may differ.
- Parity is enforced by `scripts/check-prisma-parity.cjs` (`yarn prisma:parity`) and `server/__tests__/prisma/schemaParity.test.js` (runs with `yarn test`).
- The PostgreSQL migration history is populated from the official upstream `Mintplex-Labs/anything-llm` `pg` branch (reference commit `93317de1880afccdace2c75ce83ba1281361eff1`) and adapted only as needed for the current KeplerLLM schema.

#### Out of scope

- Automatic SQLite to PostgreSQL data migration.
- A second Docker image or tag for PostgreSQL.
- Neon-specific behavior beyond standard PostgreSQL compatibility.

### Requirement 7 - Generic OpenAI Responses API mode

#### Objective

Allow the Generic OpenAI provider (`LLM_PROVIDER=generic-openai`) to use OpenAI-compatible Responses API endpoints (`POST /responses`) instead of Chat Completions (`POST /chat/completions`), selected entirely through an environment variable, without changing behavior for existing installations.

#### Observable behavior

- When `GENERIC_OPEN_AI_API_MODE` is unset, the provider uses `chat-completions`, exactly as before this change.
- When set to `chat-completions`, behavior is unchanged.
- When set to `responses`, normal chat, streaming chat, and native agent/MCP tool calling run against the Responses API through the official OpenAI SDK (`responses.create`).
- Responses results (text, reasoning, tool calls, token usage, metrics) are normalized into the existing internal contracts, so chat, streaming, and the agent loop work without protocol-specific branches downstream.
- During multi-turn agent tool execution, the provider chains the Responses continuation identifier within the active run when the provider supports it, and retries once stateless when the provider rejects it.
- Chained continuation requests send only newly produced input (for example just the `function_call_output`); the stateless retry instead resends the complete reconstructed history so the request stays independently valid. Continuation state never leaves the active agent run.
- An invalid value logs a clear warning and falls back to `chat-completions`.
- At startup the provider logs the selected protocol (without credentials):

```text
[GenericOpenAiLLM] Inference API: https://api.meta.ai/v1 Model: muse-spark-1.3-contributor API mode: responses
```

Example configuration:

```env
LLM_PROVIDER=generic-openai
GENERIC_OPEN_AI_BASE_PATH=https://api.meta.ai/v1
GENERIC_OPEN_AI_MODEL_PREF=muse-spark-1.3-contributor
GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT=1048576
GENERIC_OPEN_AI_MAX_TOKENS=131072
GENERIC_OPEN_AI_API_KEY=<secret>
GENERIC_OPEN_AI_API_MODE=responses
```

#### Rules and limits

- Environment-variable configuration only. There is no UI setting for the protocol mode.
- `chat-completions` remains the default; existing installations without the new variable observe no behavioral change.
- The provider must support the Responses API; Chat Completions-only backends keep working through the default mode.
- Responses mode is particularly useful for agentic workloads and providers that support reasoning continuity.
- In Responses mode `GENERIC_OPEN_AI_MAX_TOKENS` maps to `max_output_tokens`, Responses usage (`input_tokens`/`output_tokens`/`total_tokens`) maps to the existing prompt/completion/total metrics, and `temperature` is omitted from Responses requests because Responses-only reasoning deployments commonly reject it. Chat Completions mode keeps sending `temperature` exactly as before.
- Model discovery (`/v1/models` via `models.list()`) is unchanged, and `GENERIC_OPEN_AI_MODEL_PREF` may still name a model that `/models` does not list.
- Relevant implementation lives in `server/utils/AiProviders/genericOpenAi/` (shared protocol adapters in `responses.js`) and `server/utils/agents/aibitat/providers/genericOpenAi.js`. The AIbitat agent loop itself is unchanged.

#### Out of scope

- Supporting providers that are not OpenAI-compatible.
- Persisting Responses continuation identifiers across conversations; chaining state is scoped to the active agent run.

### Requirement 8 - Remote MCP servers through environment variables

#### Objective

Define remote Streamable HTTP MCP servers with one environment variable per server, without JSON inside envvars, reusing the existing MCP Hypervisor and MCP/AIbitat machinery.

#### Observable behavior

- Each server is defined as:

```text
MCP_<NAME>=<URL>[|<AUTH_OR_HEADER>...]
```

- Examples (fake credentials):

```env
MCP_CLASSLOG_BANCO_DADOS=https://mcp-pg.example.com/XXX/mcp
MCP_CLASSLOG_BANCO_DADOS=https://mcp-pg.example.com/XXX/mcp|Bearer|TOKEN
MCP_CLASSLOG_CODIGO_FONTE=https://src.example.com/XXX/mcp|Basic|Usuario:Senha
MCP_OUTRO=https://example.com/mcp|X-USER|XXX|X-PASS|YYY
MCP_OUTRO=https://example.com/mcp|Bearer|TOKEN|X-USER|Fernando|X-APP|Classlog
```

- The part after `MCP_` becomes the server name: remove the prefix, lowercase, replace `_` with `-`. For example `MCP_CLASSLOG_BANCO_DADOS` becomes `classlog-banco-dados`.
- Environment definitions are always remote Streamable HTTP servers. No `type` needs to be specified.
- Supported value grammar:

```text
<URL>
<URL>|Bearer|<TOKEN>
<URL>|Basic|<USERNAME>:<PASSWORD>
<URL>|<HEADER>|<VALUE> [...]
<URL>|Bearer|<TOKEN>|<HEADER>|<VALUE> [...]
<URL>|Basic|<USERNAME>:<PASSWORD>|<HEADER>|<VALUE> [...]
```

- `Bearer` and `Basic` are matched case-insensitively in the auth position. `Bearer` produces `Authorization: Bearer <TOKEN>` with canonical spelling. `Basic` takes exactly one `Username:Password` value, split on the first `:` only, so the password may contain additional colons, and produces `Authorization: Basic <base64>`.
- Anything else is an ordinary `<HEADER>|<VALUE>` pair run until the end of the value. Header names and values are preserved verbatim (exact casing and spacing; no trimming). Only `Bearer` and `Basic` are special.
- `|` is the reserved delimiter. There is no escaping, quoting, or `\|` syntax. Values containing a literal `|` are unsupported.
- Discovery is conservative: a `MCP_*` variable is treated as a server only when its value begins with a valid `http://` or `https://` URL. Unrelated flags such as `MCP_NO_COOLDOWN` are never treated as servers.
- Effective configuration is `anythingllm_mcp_servers.json` merged with `MCP_*` definitions at load/reload time. Environment wins by server name. An environment-defined MCP name shadows the same name in `anythingllm_mcp_servers.json` even when the environment definition is invalid, so a malformed envvar reports an environment configuration error instead of silently falling back to stale file configuration. Environment definitions are never written into the JSON file. Removing an envvar restores the underlying file definition on the next reload/restart.
- An invalid `MCP_*` definition fails only that server with a useful per-server message. It never crashes boot or hides the remaining servers.

#### Rules and limits

- Environment-variable configuration only. There is no JSON env configuration and no per-server envvar sprawl beyond one variable per server.
- Environment-managed servers appear in the MCP list with `source: "environment"`, normal running/error/tool status, and normal start/stop/reload behavior. Permanent Delete is rejected for them; change deployment envvars instead.
- Tool-suppression toggles for environment-managed servers persist only safe `anythingllm` metadata (`suppressedTools`, `autoStart`). URLs, tokens, passwords, and header values are never written to the JSON file for them.
- The frontend/API never receives full URLs, URL paths, query strings, fragments, URL-embedded credentials, tokens, passwords, `Authorization` values, arbitrary header values, or original `MCP_*` values. Only the hostname/domain (via URL parsing), transport type, source, header names, safe `anythingllm` metadata, status, tools, and sanitized errors are exposed. This redaction applies to file-managed servers as well.
- Logs and error messages identify servers by normalized name and safe hostname only. Transport errors are sanitized before logging or returning to the UI.
- Relevant implementation lives in `server/utils/MCP/env.js` (pure parser/merge/sanitizer helpers), `server/utils/MCP/hypervisor/index.js` (effective config, secret-safe boot/logging), `server/utils/MCP/index.js` (sanitized `servers()`, environment-managed delete guard), and `frontend/src/pages/Admin/Agents/MCPServers/` (environment indicator, redacted config display).
- No new MCP transport, Hypervisor, config file, or agent framework was introduced.

#### Out of scope

- Pipe escaping or quoting rules.
- JSON inside environment variables.
- Non-HTTP transports through envvars (stdio/SSE remain file-configured).
- Automatic data migration of any kind.

### Requirement 9 - Default workspace bootstrap from environment variables

#### Objective

Provision the default AnythingLLM workspace on first boot from environment variables, without shell hacks, external API calls, startup curl commands, direct SQL scripts, or bypassing the existing AnythingLLM models/services.

#### Observable behavior

- When none of the `DEFAULT_WORKSPACE_*` variables are defined, behavior is exactly upstream AnythingLLM behavior.
- When any `DEFAULT_WORKSPACE_*` variable is defined, the server ensures the configured workspace exists during application initialization, then treats the database as the source of truth.
- If the configured workspace does not exist, it is created through the existing Workspace model layer with the supplied values and persisted normally to SQLite or PostgreSQL.
- If the workspace already exists, bootstrap does not overwrite values changed through the UI or API. Restarting or redeploying the same container is idempotent and never creates duplicates.
- `DEFAULT_WORKSPACE_SLUG`, when explicitly provided, identifies the workspace. When omitted, the existing AnythingLLM slug-generation behavior is used.
- `DEFAULT_WORKSPACE_CHAT_MODE` maps to workspace `chatMode`. Accepted values are `chat`, `query`, and `automatic`.
- `DEFAULT_WORKSPACE_CHAT_COMPLETIONS_TEMPERATURE` maps to workspace `openAiTemp`. It must be a number `>= 0`.
- `DEFAULT_WORKSPACE_HISTORY` maps to workspace `openAiHistory`. It must be an integer `>= 0`.
- Numeric values are parsed strictly. For example `DEFAULT_WORKSPACE_CHAT_COMPLETIONS_TEMPERATURE=foo` and `DEFAULT_WORKSPACE_HISTORY=abc` fail startup with an actionable configuration error instead of being silently coerced.
- All variables except the workspace name are optional. For example `DEFAULT_WORKSPACE_NAME` plus `DEFAULT_WORKSPACE_SLUG` without a system prompt is valid, and `DEFAULT_WORKSPACE_NAME` plus a system prompt without a slug uses normal slug generation. Unset variables leave the corresponding AnythingLLM defaults intact. An unset variable is never stored as an empty database value.
- When any `DEFAULT_WORKSPACE_*` variable is set but `DEFAULT_WORKSPACE_NAME` is missing, startup fails with a clear error naming the required variable.

#### System prompt sources

Three sources are supported with precedence over non-empty values:

```text
non-empty FILE > non-empty BASE64 > plain
```

An empty or whitespace-only `DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE` or `DEFAULT_WORKSPACE_SYSTEM_PROMPT_BASE64` behaves as not configured, so an optional variable declared but left empty (common in Docker/CapRover) never shadows a usable lower-precedence source. A non-empty invalid value still fails startup clearly without falling back.

Simple prompt:

```env
DEFAULT_WORKSPACE_NAME=Kepler
DEFAULT_WORKSPACE_SLUG=kepler
DEFAULT_WORKSPACE_SYSTEM_PROMPT="You are Kepler AI."
DEFAULT_WORKSPACE_CHAT_MODE=chat
DEFAULT_WORKSPACE_CHAT_COMPLETIONS_TEMPERATURE=1
DEFAULT_WORKSPACE_HISTORY=20
```

The plain-text value is used verbatim. Whitespace and newlines are preserved exactly.

Base64 prompt:

```env
DEFAULT_WORKSPACE_SYSTEM_PROMPT_BASE64=<base64-value>
```

Generate the value with a portable command:

```bash
base64 < system-prompt.txt | tr -d '\n'
```

On macOS `base64` wraps output by default; piping through `tr -d '\n'` produces the single-line form expected in environment variables. GNU/Linux `base64` without `-w0` also wraps, so the same portable command works on both platforms. The decoder also ignores ASCII whitespace, so wrapped output without stripping still decodes.

Base64 is decoded as standard Base64 to UTF-8. The decoded contents become workspace `openAiPrompt` exactly, with whitespace and newlines preserved. Malformed Base64 fails startup with an actionable error and never silently falls back to the plain-text variable. Decoded bytes that are not valid UTF-8 fail startup with an actionable error.

File prompt:

```env
DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE=/run/secrets/kepler-system-prompt.txt
```

The file is read as UTF-8 and stored verbatim. The file must exist and be readable; invalid UTF-8 produces a clear startup error. This mode avoids operating-system environment-variable size limits and supports Docker/Kubernetes secret files.

#### Size handling

No unnecessarily small application-level prompt limit is imposed. Prompts are never truncated. Linux places practical limits on individual environment strings and Base64 increases payload size by approximately 33%. Recommended operational guidance is to keep decoded system prompts at or below approximately 64 KiB in plain/Base64 environment mode and to use `DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE` for substantially larger prompts.

#### Rules and limits

- Bootstrap-only: environment variables are not continuously authoritative. They never override database values on restart.
- Concurrent initialization cannot normally create duplicate workspaces. Creation with an explicit slug is atomic; creation without an explicit slug reuses upstream slug generation and recovers from unique-constraint races by reusing the existing workspace.
- Existing Workspace validation rules and accepted values are reused. No separate incompatible slug algorithm is introduced and no database schema change is required.
- The system prompt is potentially sensitive configuration. Its contents, and the complete Base64 value, are never emitted into normal logs. Startup logs only safe metadata, for example:

```text
Default workspace bootstrap enabled
workspace=kepler
systemPromptSource=base64
systemPromptBytes=18432
```

#### Out of scope

- Making environment variables permanently authoritative over workspace configuration.
- Automatic data migration of any kind.
- Changing existing AnythingLLM workspace creation, UI-created workspaces, API-created workspaces, migrations, or upstream defaults.

### Requirement 10 - Optional Settings button hiding

#### Objective

Optionally hide Settings entry buttons to discourage casual or curious access by trusted users.

#### Observable behavior

- When `KEPLERLLM_HIDE_SETTINGS_BUTTONS` is absent, the UI is exactly upstream behavior.
- When `KEPLERLLM_HIDE_SETTINGS_BUTTONS` is present with any value (including `false`), the per-workspace settings gear and the Settings entry `Wrench` are hidden, while the `Back to workspaces` button inside `/settings/*` remains visible. Presence semantics match `DISABLE_VIEW_CHAT_HISTORY` and `WORKSPACE_DELETION_PROTECTION`.
- Only those two controls are hidden. Workspaces, uploads, threads, chat controls, footer icons, and all other actions are unchanged.
- Direct Settings URLs (`/settings/...`, `/workspace/:slug/settings/...`), routes, and APIs keep working with no redirect, 403, or access restriction.
- Running `showButtons()` in browser DevTools reveals both controls immediately in the current tab with no reload. The override is in-memory only; a full reload hides them again while the environment variable is present.

#### Rules and limits

- UI-only change. This is not a security boundary.
- Runtime server environment variable only. There is no `VITE_*` build-time variable, no database persistence, and no UI toggle.
- The server exposes `HideSettingsButtons` through the existing `SystemSettings.currentSettings()` / `/setup-complete` / `System.keys()` mechanism.
- Relevant implementation lives in `server/models/systemSettings.js`, `frontend/src/hooks/useHideSettingsButtons.js`, `frontend/src/utils/settingsButtonsVisibility.js`, `frontend/src/components/SettingsButton/index.jsx`, and `frontend/src/components/Sidebar/ActiveWorkspaces/index.jsx`.

#### Out of scope

- Route protection, authentication, authorization, RBAC, middleware, redirects, or server-side access restrictions.
- Hiding any other UI element.

### Requirement 11 - Default Agent Skills bootstrap from an environment variable

#### Objective

Enable the opt-in AnythingLLM Agent Skills on first boot from a single environment variable, without shell hacks, external API calls, startup curl commands, direct SQL scripts, or bypassing the existing AnythingLLM models/services.

#### Observable behavior

- When `DEFAULT_AGENT_SKILLS` is unset, behavior is exactly upstream AnythingLLM behavior. No `default_agent_skills` row is created or modified merely because KeplerLLM booted.
- When `DEFAULT_AGENT_SKILLS` is set and no `default_agent_skills` system setting row exists yet, the server persists the parsed list during application initialization through the existing SystemSettings model layer, identically on SQLite and PostgreSQL.
- The value is a comma-separated list of skill identifiers. Surrounding whitespace is trimmed, empty entries from repeated separators are removed, and duplicates are removed with deterministic ordering. Example:

```env
DEFAULT_AGENT_SKILLS=filesystem-agent,create-files-agent,create-chart,web-browsing,sql-agent,create-scheduled-job
```

- On a fresh/unconfigured instance, the listed Agent Skill toggles start enabled.
- Setting `DEFAULT_AGENT_SKILLS` explicitly to the empty string is intentional configuration: it bootstraps an empty list, so no opt-in Agent Skills are enabled initially.
- Once the `default_agent_skills` row exists, it is never overwritten, even when `DEFAULT_AGENT_SKILLS` is currently different. Changes made through the UI or API survive restart and redeploy. After initialization, the database is the source of truth; the environment variable is a default/bootstrap value, not continuously authoritative configuration.
- An unknown skill identifier fails startup clearly and early with an error naming `DEFAULT_AGENT_SKILLS` and the invalid identifier, along with the accepted identifiers. Nothing is partially persisted when one member is invalid.

#### Accepted values

At the current `1.16.1` baseline, the accepted identifiers are the user-facing opt-in Agent Skills:

```text
filesystem-agent
create-files-agent
create-chart
web-browsing
sql-agent
create-scheduled-job
```

#### Rules and limits

- Bootstrap-only: the environment variable is read to initialize the setting. It never overrides database values on restart.
- The existence of the `system_settings` row with label `default_agent_skills` is itself the initialized marker. No extra bootstrap marker setting is used.
- This variable controls the opt-in `default_agent_skills` set only. It does not control the default-enabled skills represented by `disabled_agent_skills` (`rag-memory`, `document-summarizer`, `web-scraping`), whose semantics are unchanged.
- Server-side validation uses a small explicit canonical list aligned with the configurable skills shown by the Agent Skills UI, so internal plugins, app-integration skills (`gmail-agent`, `google-calendar-agent`, `outlook-agent`), imported Custom Skills, Agent Flows, and MCP servers can never be enabled through this variable.
- The bootstrap completes before the listening socket becomes available, following the default workspace bootstrap fail-fast pattern. Startup logs only safe metadata (skill names and count), never secrets.
- No database schema migration is required.

#### Out of scope

- Making the environment variable permanently authoritative over Agent Skill configuration.
- Changing `disabled_agent_skills` semantics or the default-enabled skills.
- Configuring Gmail, Google Calendar, Outlook, Custom Skills, Agent Flows, or MCP servers.
- Automatic data migration of any kind.

## Appendix - Operational reference

This appendix records only the runtime and publishing facts needed to operate the fork. It does not describe implementation.

### Supported upstream baseline

The fork tracks a stable AnythingLLM baseline. The current baseline is:

```text
1.16.1
```

### Runtime configuration

| Variable                       | Default               | Behavior                                                                                       |
| ------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------- |
| `STORAGE_DIR`                  | `/app/server/storage` | Standard storage volume. Holds UI configuration and skill data. Still required with PostgreSQL. |
| `KEPLERLLM_MODEL_DISPLAY_NAME` | `Kepler AI`           | Product label shown in the workspace model picker.                                             |
| `DATABASE_URL`                 | unset                 | When unset, SQLite is used. When set to `postgresql://...`, PostgreSQL is used.                |
| `GENERIC_OPEN_AI_API_MODE`     | `chat-completions`    | Generic OpenAI protocol: `chat-completions` (default) or `responses` (Responses API).          |
| `MCP_<NAME>`                   | unset                 | One remote Streamable HTTP MCP server per variable, e.g. `MCP_DOCS=https://host/XXX/mcp`. Env wins over the MCP JSON file. |
| `DEFAULT_WORKSPACE_NAME`       | unset                 | Bootstrap workspace name. Required when any `DEFAULT_WORKSPACE_*` variable is set.             |
| `DEFAULT_WORKSPACE_SLUG`       | unset                 | Bootstrap workspace slug. When set, it identifies the workspace. When unset, upstream slug generation is used. |
| `DEFAULT_WORKSPACE_SYSTEM_PROMPT` | unset              | Bootstrap system prompt as plain text, used verbatim. Lowest prompt precedence.                |
| `DEFAULT_WORKSPACE_SYSTEM_PROMPT_BASE64` | unset       | Bootstrap system prompt as standard Base64 UTF-8. Middle prompt precedence.                    |
| `DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE` | unset         | Bootstrap system prompt as a UTF-8 file path (e.g. `/run/secrets/kepler-system-prompt.txt`). Highest prompt precedence. |
| `DEFAULT_WORKSPACE_CHAT_MODE`  | unset                 | Bootstrap `chatMode`: `chat`, `query`, or `automatic`. Unset leaves the upstream default.      |
| `DEFAULT_WORKSPACE_CHAT_COMPLETIONS_TEMPERATURE` | unset                | Bootstrap `openAiTemp` as a number `>= 0`. Unset leaves the upstream default.                  |
| `DEFAULT_WORKSPACE_HISTORY`    | unset                 | Bootstrap `openAiHistory` as an integer `>= 0`. Unset leaves the upstream default.             |
| `DEFAULT_AGENT_SKILLS`         | unset                 | Bootstrap opt-in Agent Skills as a comma-separated list. Unset preserves upstream behavior. Empty string enables none. Existing DB configuration is never overwritten. |
| `KEPLERLLM_HIDE_SETTINGS_BUTTONS` | unset              | When present with any value, hide Settings entry buttons in the UI only. Direct URLs still work. |

The deployment mounts only:

```text
/app/server/storage
```

No extra volume is required for agent-authored skill drafts; they live under the existing storage volume.

### Build and publish

`.envrc` sets `IMAGE_TAG` to the current short Git commit hash. `compose.yaml` publishes both that immutable tag and `latest`.

After committing or pulling changes, set `IMAGE_TAG` from the current `HEAD` before building so a pasted multi-command block does not retain a stale direnv value:

```bash
export IMAGE_TAG="$(git rev-parse --short HEAD)"
docker compose build --push
```

Published images:

```text
cr.umapps.net/umapps/keplerllm:${IMAGE_TAG}
cr.umapps.net/umapps/keplerllm:latest
```

The Compose build builds for both `linux/amd64` and `linux/arm64`.

## CapRover

Use:

```text
STORAGE_DIR=/app/server/storage
```

For PostgreSQL, also set:

```text
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
```

When `DATABASE_URL` is unset, SQLite is used at `/app/server/storage/anythingllm.db`. Adding it switches to PostgreSQL without migrating SQLite data. Removing it selects SQLite again if the file still exists. `STORAGE_DIR` is still required with PostgreSQL.

Optionally customize the model label:

```text
KEPLERLLM_MODEL_DISPLAY_NAME=Kepler AI
```

Optionally define remote MCP servers (one variable per server, Streamable HTTP, fake values shown):

```text
MCP_DOCS=https://mcp.example.com/XXX/mcp
MCP_DOCS=https://mcp.example.com/XXX/mcp|Bearer|TOKEN
MCP_CODE=https://src.example.com/XXX/mcp|Basic|Usuario:Senha
```

Names normalize `MCP_<NAME>` to lowercase with `_` as `-`. Environment definitions override same-name entries in `anythingllm_mcp_servers.json` without writing to that file. Only the hostname is shown in the UI; paths, queries, and header values are redacted.

Optionally bootstrap the default workspace (bootstrap-only, idempotent; fake prompt shown):

```text
DEFAULT_WORKSPACE_NAME=Kepler
DEFAULT_WORKSPACE_SLUG=kepler
DEFAULT_WORKSPACE_SYSTEM_PROMPT="You are Kepler AI."
DEFAULT_WORKSPACE_CHAT_MODE=chat
DEFAULT_WORKSPACE_CHAT_COMPLETIONS_TEMPERATURE=1
DEFAULT_WORKSPACE_HISTORY=20
```

For large or multiline prompts prefer Base64 or a secret file. Portable Base64 encoding:

```bash
base64 < system-prompt.txt | tr -d '\n'
```

```text
DEFAULT_WORKSPACE_SYSTEM_PROMPT_BASE64=<base64-value>
```

```text
DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE=/run/secrets/kepler-system-prompt.txt
```

Prompt precedence is `non-empty FILE > non-empty BASE64 > plain` (empty FILE/BASE64 behave as not configured). The database is the source of truth after creation; restarts never overwrite UI/API changes. Keep decoded environment prompts at or below approximately 64 KiB; use the file mode for substantially larger prompts. Base64 increases payload size by approximately 33%.

Optionally bootstrap the opt-in Agent Skills (bootstrap-only, idempotent):

```text
DEFAULT_AGENT_SKILLS=filesystem-agent,create-files-agent,create-chart,web-browsing,sql-agent,create-scheduled-job
```

When unset, upstream behavior is preserved. An explicit empty string enables no opt-in skills initially. Accepted values are `filesystem-agent`, `create-files-agent`, `create-chart`, `web-browsing`, `sql-agent`, and `create-scheduled-job`. An existing `default_agent_skills` database setting is never overwritten; the database is the source of truth after initialization. Invalid identifiers fail startup. Behavior is identical on SQLite and PostgreSQL. This variable does not control the default-enabled skills represented by `disabled_agent_skills`.

Optionally hide Settings entry buttons in the UI only (direct Settings URLs remain accessible):

```text
KEPLERLLM_HIDE_SETTINGS_BUTTONS=1
```

Keep the named volume:

```text
anythingllm-storage -> /app/server/storage
```

No extra volume is required for agent-authored skill drafts; they live under the existing storage volume.

Existing AnythingLLM collector volumes can remain unchanged.
