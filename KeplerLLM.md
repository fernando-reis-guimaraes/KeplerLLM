# KeplerLLM

> Canonical specification in English (US). Portuguese version: [KeplerLLM.pt-BR.md](KeplerLLM.pt-BR.md).

KeplerLLM is a fork of AnythingLLM. It preserves upstream behavior except for the fork changes defined below.

The fork adds persistent UI configuration with a single storage volume, a product model label, alphabetical OpenAI model ordering, agent-authored Custom Skill staging with human approval, dynamic SQLite/PostgreSQL backend selection from a single Docker image, an optional OpenAI-compatible Responses API mode for the Generic OpenAI provider, remote MCP server configuration through environment variables, default workspace bootstrap from environment variables, default Agent Skills bootstrap from an environment variable, an optional UI-only hiding of Settings entry buttons, sidebar thread internationalization, a runtime-configurable default UI language, optional runtime UI visibility controls, and an opt-in temporary Safari/WebKit cross-origin iframe link-click compatibility workaround.

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

- When `KEPLERLLM_HIDE_SETTINGS_BUTTONS` is unset, empty, or set to any value other than `true`/`1`, the UI is exactly upstream behavior.
- When `KEPLERLLM_HIDE_SETTINGS_BUTTONS` is set to `true` or `1` (case-insensitive, surrounding whitespace trimmed), the per-workspace settings gear and the Settings entry `Wrench` are hidden, while the `Back to workspaces` button inside `/settings/*` remains visible. Strict boolean semantics match `DISABLE_VIEW_CHAT_HISTORY` and `WORKSPACE_DELETION_PROTECTION`: `true`/`1` enable, while `false`, `0`, empty, unset, or any other value disable.
- Only those two controls are hidden. Workspaces, uploads, threads, chat controls, footer icons, and all other actions are unchanged.
- Direct Settings URLs (`/settings/...`, `/workspace/:slug/settings/...`), routes, and APIs keep working with no redirect, 403, or access restriction.
- Running `showButtons()` in browser DevTools reveals both controls immediately in the current tab with no reload. The override is in-memory only; a full reload hides them again while the environment variable is set to `true`/`1`.

#### Rules and limits

- UI-only change. This is not a security boundary.
- Runtime server environment variable only. There is no `VITE_*` build-time variable, no database persistence, and no UI toggle.
- The server exposes `HideSettingsButtons` through the existing `SystemSettings.currentSettings()` / `/setup-complete` / `System.keys()` mechanism.
- Relevant implementation lives in `server/models/systemSettings.js`, `server/utils/helpers/parseBooleanEnv.js` (shared strict boolean parser), `frontend/src/hooks/useHideSettingsButtons.js`, `frontend/src/utils/settingsButtonsVisibility.js`, `frontend/src/components/SettingsButton/index.jsx`, and `frontend/src/components/Sidebar/ActiveWorkspaces/index.jsx`.

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

- On a fresh/unconfigured instance, the listed Agent Skills are persisted as enabled defaults, subject to the existing upstream availability, mode, and runtime restrictions.
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
- `DEFAULT_AGENT_SKILLS` only initializes the existing `default_agent_skills` system setting. It does not bypass skill availability checks (for example `filesystem-agent` and `create-files-agent`) or single-user/multi-user restrictions (for example `create-scheduled-job`, which is unavailable in multi-user mode).
- Server-side validation uses a small explicit canonical list aligned with the configurable skills shown by the Agent Skills UI, so internal plugins, app-integration skills (`gmail-agent`, `google-calendar-agent`, `outlook-agent`), imported Custom Skills, Agent Flows, and MCP servers can never be enabled through this variable.
- The bootstrap completes before the listening socket becomes available, following the default workspace bootstrap fail-fast pattern. Startup logs only safe metadata (skill names and count), never secrets.
- No database schema migration is required.

#### Out of scope

- Making the environment variable permanently authoritative over Agent Skill configuration.
- Changing `disabled_agent_skills` semantics or the default-enabled skills.
- Configuring Gmail, Google Calendar, Outlook, Custom Skills, Agent Flows, or MCP servers.
- Automatic data migration of any kind.

### Requirement 12 - Sidebar thread internationalization

#### Objective

Translate the workspace sidebar thread labels that upstream AnythingLLM hardcodes in English, without changing server behavior or stored data.

#### Observable behavior

- The sidebar uses the `workspace-thread` translation keys from `frontend/src/locales/*/common.js`:
  - `thread` for the thread display name (for example `Conversa` in Portuguese).
  - `new-thread` for the creation button (for example `Nova conversa` in Portuguese).
  - `starting-thread` for the creation loading state.
- The virtual thread row and the `New Thread` button render through `useTranslation()` in `frontend/src/components/Sidebar/ActiveWorkspaces/ThreadContainer/index.jsx`.
- Rows stored with the legacy server default name (`Thread` or `*New Thread`) render with the translated display name in `frontend/src/components/Sidebar/ActiveWorkspaces/ThreadContainer/ThreadItem/index.jsx`, so existing workspaces translate without a data migration.
- The selected UI language controls the labels. English behavior is unchanged (`Thread` / `New Thread`).

#### Rules and limits

- Display-only change. `WorkspaceThread.defaultName` in `server/models/workspaceThread.js` remains `"Thread"`, and thread rename behavior (`autoRenameThread`) is unchanged.
- No database schema migration is required and no stored thread names are rewritten.
- Translation keys are defined in `frontend/src/locales/en/common.js` and replicated across all locale files so `yarn translations:verify` passes.

#### Out of scope

- Translating other hardcoded thread management strings (rename/delete prompts, toasts, bulk-delete UI).
- Changing the server-side default thread name per locale.
- Migrating or rewriting existing thread rows.

### Requirement 13 - Runtime-configurable default UI language

#### Objective

Select the initial UI language from a server-side runtime environment variable, so container platforms that supply environment variables at runtime (including CapRover) work without rebuilding the frontend.

#### Observable behavior

- When `DEFAULT_UI_LANGUAGE` is unset and no explicit KeplerLLM language preference exists, the UI falls back to browser language detection with `en` fallback. Legacy `i18nextLng` values are intentionally not treated as explicit preferences because they may have been written automatically by i18next, so this differs from upstream handling of the generic cached language.
- For a browser/session with no explicit KeplerLLM language preference:
  - `DEFAULT_UI_LANGUAGE=pt` starts the UI in Brazilian Portuguese.
  - `DEFAULT_UI_LANGUAGE=en` starts the UI in English.
- `pt` maps to the existing Brazilian Portuguese translation (`frontend/src/locales/pt_BR/common.js` registered under the `pt` locale key). The `pt` locale key is unchanged.
- Language selection precedence is:
  1. Explicit KeplerLLM user language preference.
  2. `DEFAULT_UI_LANGUAGE`.
  3. Browser-detected language.
  4. `en`.
- `DEFAULT_UI_LANGUAGE` is a default, not a forced language. A manual change through the existing UI is stored separately and continues to override the environment default on subsequent visits.
- `i18nextLng` is not treated as proof of an explicit user selection: i18next automatically caches the detected/default language there, so it cannot distinguish an explicit choice from automatic detection. KeplerLLM stores an explicit choice separately under `keplerllmExplicitUILanguage`, written only when the user changes the language through the UI. `DEFAULT_UI_LANGUAGE` therefore also applies to existing users who never manually selected a language.
- An invalid or unsupported value is ignored safely and the existing fallback behavior is preserved.

#### Rules and limits

- Runtime server environment variable only. There is no `VITE_*` build-time variable because the Docker image is built before CapRover runtime environment variables are supplied.
- The frontend receives the value from the running server through the existing `window.__KEPLERLLM_CONFIG__` bootstrap rendered per request by `MetaGenerator` (`server/utils/boot/keplerllmConfig.js`, `server/utils/boot/MetaGenerator.js`). No new runtime mechanism or dependency is introduced, and no unrelated or sensitive environment variables are exposed to the frontend.
- Validation happens against the language keys actually exported by `frontend/src/locales/resources.js`. No duplicated hardcoded language list is maintained. Input is normalized (trim, lowercase, `_` to `-`) with base-language fallback (for example `pt-BR` resolves to `pt`), without breaking the existing locale naming conventions.
- The explicit preference is never migrated from `i18nextLng`, since a cached `i18nextLng` value may come from automatic detection. Absence of the explicit-preference key means "no explicit user preference". The existing `i18nextLng` cache keeps being written by the detector and is left otherwise untouched.
- Relevant implementation lives in `server/utils/boot/keplerllmConfig.js`, `frontend/src/utils/defaultUILanguage.js`, `frontend/src/i18n.js`, and `frontend/src/hooks/useLanguageOptions.js` (manual selection persistence only). No new UI is introduced.
- Single-user and multi-user operation are unchanged. Existing translations are preserved. When the variable is unset and no explicit preference exists, browser language detection is used; only the ambiguous legacy `i18nextLng` cache is excluded from precedence.

#### Out of scope

- Forcing a language regardless of explicit user choice.
- Renaming the existing `pt` locale key.
- Persisting the default in the database or adding a UI toggle.

### Requirement 14 - Optional runtime UI visibility controls

#### Objective

Optionally hide specific UI controls to simplify the KeplerLLM UI without changing permissions, routes, APIs, underlying capabilities, or upstream behavior when the variables are absent.

#### Observable behavior

- Four independent runtime-only environment variables are supported:

```text
KEPLERLLM_HIDE_TOOLS_BUTTON
KEPLERLLM_HIDE_CREATE_AGENT_BUTTON
KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON
KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON
```

- Strict boolean semantics match `KEPLERLLM_HIDE_SETTINGS_BUTTONS`, `DISABLE_VIEW_CHAT_HISTORY`, and `WORKSPACE_DELETION_PROTECTION`:
  - Variable set to `true` or `1` (case-insensitive, surrounding whitespace trimmed) -> hide the corresponding UI element.
  - Variable unset, empty, or set to `false`, `0`, or any other value -> normal existing behavior.
- When `KEPLERLLM_HIDE_TOOLS_BUTTON` is set to `true` or `1`, the visible Tools button in the shared `PromptInput` component (`frontend/src/components/WorkspaceChat/ChatContainer/PromptInput/index.jsx`) does not render. This applies everywhere the shared component is rendered, including the main/home prompt and the workspace chat prompt. The ToolsMenu implementation, `/` keyboard behavior that can open the Tools menu, slash commands, Agent Skills, agent execution, MCP tools, APIs, backend capabilities, authorization, and workspace configuration are unchanged.
- When `KEPLERLLM_HIDE_CREATE_AGENT_BUTTON` is set to `true` or `1`, the quick action for `main-page.quickActions.createAgent` does not render (`frontend/src/components/lib/QuickActions/index.jsx`). Existing role-based visibility is preserved, so effective visibility is existing upstream visibility AND not hidden by runtime configuration. The target route and Agent Skills behavior are unchanged.
- When `KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON` is set to `true` or `1`, the quick action for `main-page.quickActions.editWorkspace` does not render. All existing conditions, including the available workspace requirement, role checks, and navigation behavior, are preserved. Direct workspace settings URLs and other ways of reaching workspace settings remain unchanged.
- When `KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON` is set to `true` or `1`, only the quick action for `main-page.quickActions.uploadDocument` does not render. Drag-and-drop uploads, pasted file uploads, attachments in chat, upload APIs, document management, and workspace document ingestion are unchanged.
- If runtime configuration and/or existing permission logic results in zero visible Quick Actions, the entire `QuickActions` component renders nothing. No empty container and no `mt-6` spacing remain. For example all three actions hidden renders no wrapper, while only Upload Document visible renders the wrapper with Upload Document only.
- When all four variables are unset (or set to `false`, `0`, empty, or any other non-enabling value), the rendered UI and behavior are identical to the current KeplerLLM implementation.

#### Rules and limits

- UI-only change. These are not security boundaries. Direct routes, APIs, and capabilities remain available.
- Runtime server environment variables only. There is no `VITE_*` build-time variable, no database migration, no new UI settings, no persistent database configuration, no route changes, no authorization changes, and no API contract changes.
- The server exposes only normalized booleans (`hideToolsButton`, `hideCreateAgentButton`, `hideEditWorkspaceButton`, `hideUploadDocumentButton`) through the existing `window.__KEPLERLLM_CONFIG__` bootstrap rendered per request by `MetaGenerator` (`server/utils/boot/keplerllmConfig.js`, `server/utils/boot/MetaGenerator.js`). No second runtime configuration mechanism is introduced and no raw environment variable values are exposed to the frontend.
- Relevant implementation lives in `server/utils/helpers/parseBooleanEnv.js` (shared strict boolean parser), `server/utils/boot/keplerllmConfig.js`, `frontend/src/utils/keplerllmVisibility.js`, `frontend/src/hooks/useKeplerllmVisibility.js`, `frontend/src/components/WorkspaceChat/ChatContainer/PromptInput/index.jsx`, and `frontend/src/components/lib/QuickActions/index.jsx`.
- Example operational configuration:

```env
KEPLERLLM_HIDE_TOOLS_BUTTON=true
KEPLERLLM_HIDE_CREATE_AGENT_BUTTON=true
KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON=true
KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON=true
```

- No frontend rebuild is required; configuration is runtime-only.

#### Out of scope

- Route protection, authentication, authorization, RBAC, middleware, redirects, or server-side access restrictions.
- Disabling backend capabilities, upload ingestion, agent execution, or MCP tools.
- Hiding any other UI element.

### Requirement 15 - Strict boolean environment-variable parsing

#### Objective

Resolve every environment variable whose value genuinely represents a boolean through one shared strict parser, so mere presence of a variable (including values such as `false`, `0`, or empty, common on platforms like CapRover) never enables a feature.

#### Observable behavior

- The shared server-side parser (`server/utils/helpers/parseBooleanEnv.js`, also used by the collector entrypoint) resolves `true` only for `true`/`"true"`/`1`/`"1"` (strings trimmed and case-insensitive). Everything else (`false`, `"false"`, `0`, `"0"`, `""`, `"null"`, `"undefined"`, `"yes"`, `"no"`, `"on"`, `"off"`, arbitrary values, unset) resolves to `false` without throwing.
- The following boolean flags use the shared parser:
  - `KEPLERLLM_HIDE_SETTINGS_BUTTONS`, `KEPLERLLM_HIDE_TOOLS_BUTTON`, `KEPLERLLM_HIDE_CREATE_AGENT_BUTTON`, `KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON`, `KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON`
  - `KEPLERLLM_SAFARI_IFRAME_LINK_FIX`
  - `DISABLE_VIEW_CHAT_HISTORY`, `WORKSPACE_DELETION_PROTECTION`
  - `SIMPLE_SSO_ENABLED`, `SIMPLE_SSO_NO_LOGIN`
  - `EMBED_REQUIRE_ALLOWLIST`
  - `ENABLE_HTTP_LOGGER`, `ENABLE_HTTP_LOGGER_TIMESTAMPS`, `ENABLE_HTTPS` (parsed once; every boot check in `server/index.js` shares the result)
  - `AWS_BEDROCK_STREAMING_DISABLED`, `GENERIC_OPENAI_STREAMING_DISABLED`, `GENERIC_OPEN_AI_REPORT_USAGE`
  - `MCP_NO_COOLDOWN`
  - `DISABLE_SWAGGER_DOCS`, `DISABLE_TELEMETRY`
  - `COLLECTOR_ALLOW_ANY_IP` (parsed server-side; the collector already coerces the forwarded boolean correctly)
  - `AGENT_SKILL_RERANKER_ENABLED`, preserving its existing default: unset stays enabled, while an explicitly supplied value uses the strict parser (`"true"`/`"1"` keep it enabled; `"false"`, `"0"`, empty, or any other value disable it).
- Operational convention for every flag above: `true`/`1` enable, `false`/`0`/empty/unset/any other value disable.

#### Rules and limits

- Credential/key presence checks (for example `!!process.env.OPEN_AI_KEY`) keep their existing meaning ("is a credential configured?") and do not use the parser.
- Non-boolean domains are unchanged: enums (`LLM_PROVIDER`, `GENERIC_OPEN_AI_API_MODE`, `COMMUNITY_HUB_BUNDLE_DOWNLOADS_ENABLED` with its `allow_all` value), URLs, numerics (ports, timeouts, token limits, `AGENT_SKILL_RERANKER_TOP_N`), comma-separated lists (`PROVIDER_DISABLE_NATIVE_TOOL_CALLING`, `AGENT_AUTO_APPROVED_SKILLS`), database values, request bodies, and frontend build-time variables.
- The `DisableTelemetry` settings/API string contract is unchanged; only the server-side enforcement points use the parser.
- Relevant implementation lives in `server/utils/helpers/parseBooleanEnv.js` plus the call sites listed above. No database migration, no generated `frontend/dist` edits, and no new runtime-config mechanism were introduced.

#### Out of scope

- Changing the `COMMUNITY_HUB_BUNDLE_DOWNLOADS_ENABLED` three-state enum semantics.
- Changing routes, authorization, APIs, capabilities, or UI behavior beyond the corrected boolean configuration semantics.

### Requirement 16 - Temporary Safari/WebKit cross-origin iframe link-click compatibility workaround

#### Objective

Restore physical link clicks when KeplerLLM is embedded in a cross-origin iframe in Safari/WebKit, without redesigning routing, iframe architecture, or authentication.

#### Observable behavior

- Opt-in runtime environment variable (default disabled):

```text
KEPLERLLM_SAFARI_IFRAME_LINK_FIX=true
```

- Strict boolean semantics match the other KeplerLLM flags: `true`/`1` (case-insensitive, surrounding whitespace trimmed) enable; `false`, `0`, empty, unset, `null`, or any other value disable. Default is disabled.
- When enabled and the app is embedded cross-origin in Safari/WebKit, a physical `mouseup` on an ordinary internal navigation anchor schedules a next-task (`setTimeout(..., 0)`) fallback. If Safari dispatches the native `click` for the same anchor first, the fallback is cancelled; otherwise `anchor.click()` is called once. A healthy native click therefore yields exactly one navigation, including on Safari versions where the bug does not exist or a future version where Apple fixes it.
- Only ordinary internal KeplerLLM navigation anchors are eligible (primary button, no modifier keys, not default-prevented, still connected, same-origin `http(s)` href, target absent/empty/`_self`, no `download` attribute). External links, `target="_blank"`, downloads, `mailto:`/`tel:`/`javascript:` URLs, middle/right click, Cmd/Ctrl/Shift/Alt-click, buttons, inputs, and arbitrary elements never receive a synthesized click. The physical `mouseup` is never `preventDefault()`-ed; the existing anchor and React Router behavior remain the source of truth.
- With `KEPLERLLM_SAFARI_IFRAME_LINK_FIX=false` (or unset/empty/any non-enabling value), behavior is exactly the existing behavior with no compatibility listener active.
- No frontend rebuild is required; the operator disables the workaround by changing the environment variable and restarting/redeploying. Remove the flag entirely when Safari/WebKit no longer requires it.

#### Rules and limits

- Temporary compatibility workaround only. It is not an authentication feature, not a security boundary, does not change iframe permissions, sandboxing, CSP/CORS/COOP, Directito, reverse proxy configuration, React Router, or navigation semantics.
- Runtime server environment variable only. The server exposes only the normalized boolean `safariIframeLinkFix` through the existing `window.__KEPLERLLM_CONFIG__` bootstrap rendered per request by `MetaGenerator` (`server/utils/boot/keplerllmConfig.js`, `server/utils/boot/MetaGenerator.js`). No second runtime configuration mechanism is introduced and no raw environment variable value is exposed to the frontend.
- Activation requires all three conditions: runtime config `safariIframeLinkFix === true`, embedded app (`window.self !== window.top`, cross-origin safe, never reading `window.top.location`/`window.parent.document`), and Safari/WebKit browser detection that never classifies normal desktop Chrome/Edge/Firefox as Safari.
- Relevant implementation lives in `server/utils/helpers/parseBooleanEnv.js` (shared strict boolean parser), `server/utils/boot/keplerllmConfig.js`, `frontend/src/utils/safariIframeLinkFix.js` (event delegation, idempotent initializer with cleanup), and `frontend/src/main.jsx` (startup wiring outside React rendering/state).
- No `allow-top-navigation`, no `history.pushState` patching, no `HTMLElement.prototype.click` monkey-patch, no generic synthetic clicks for buttons or arbitrary controls, no parent DOM access, no Floating UI change, no unrelated dependency upgrade.

#### Out of scope

- Fixing the Safari/WebKit browser bug itself.
- Modifying Directito, iframe sandbox attributes, CSP/CORS/COOP, or reverse proxy assumptions.
- Replacing `<Link>` components or patching React Router.

## Appendix - Operational reference

This appendix records only the runtime and publishing facts needed to operate the fork. It does not describe implementation.

### Supported upstream baseline

The fork tracks a stable AnythingLLM baseline. The current baseline is:

```text
1.16.1
```

### Runtime configuration

Boolean flags use one shared strict convention: `true`/`1` (case-insensitive, surrounding whitespace trimmed) enable, while `false`/`0`/empty/unset/any other value disable. Mere presence of a variable never enables a boolean feature.

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
| `KEPLERLLM_HIDE_SETTINGS_BUTTONS` | unset              | When set to `true`/`1`, hide Settings entry buttons in the UI only. `false`/`0`/empty/unset/any other value shows them normally. Direct URLs still work. |
| `DEFAULT_UI_LANGUAGE`          | unset                 | Default UI language used only when no explicit KeplerLLM preference exists. Must match a supported locale key (e.g. `en`, `pt`, `es`, `fr`). `pt` selects Brazilian Portuguese. Unset falls back to browser detection with `en` fallback; legacy `i18nextLng` is ignored for precedence and invalid values are ignored. |
| `KEPLERLLM_HIDE_TOOLS_BUTTON` | unset                 | When set to `true`/`1`, hide the visible Tools button in the UI only. `false`/`0`/empty/unset/any other value shows it normally. ToolsMenu, `/` keyboard behavior, slash commands, agents, and APIs remain available. |
| `KEPLERLLM_HIDE_CREATE_AGENT_BUTTON` | unset           | When set to `true`/`1`, hide the Create an Agent quick action in the UI only. `false`/`0`/empty/unset/any other value shows it normally. Existing role checks still apply. Target route and Agent Skills behavior remain available. |
| `KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON` | unset          | When set to `true`/`1`, hide the Edit Workspace quick action in the UI only. `false`/`0`/empty/unset/any other value shows it normally. Direct workspace settings URLs remain available. |
| `KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON` | unset         | When set to `true`/`1`, hide the Upload a Document quick action in the UI only. `false`/`0`/empty/unset/any other value shows it normally. Drag-and-drop, pasted uploads, attachments, upload APIs, and ingestion remain available. |
| `KEPLERLLM_SAFARI_IFRAME_LINK_FIX` | unset (`false`) | Temporary Safari/WebKit cross-origin iframe link-click compatibility workaround. When set to `true`/`1`, restores physical clicks on ordinary internal navigation anchors when embedded cross-origin in Safari/WebKit. `false`/`0`/empty/unset/any other value disables (existing behavior). Not an authentication feature or security boundary; does not change iframe permissions or React Router. Disable when Safari/WebKit no longer requires it. Runtime-only, no frontend rebuild needed. |

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

Optionally hide Settings entry buttons in the UI only (direct Settings URLs remain accessible). Boolean convention: `true`/`1` hide, `false`/`0`/empty/unset/any other value shows normally:

```text
KEPLERLLM_HIDE_SETTINGS_BUTTONS=1
```

Optionally hide specific UI controls in the UI only (UI-only controls, not security boundaries; direct routes, APIs, and capabilities remain available; runtime-only with no frontend rebuild; strict boolean semantics with only `true`/`1` meaning hide; unset, empty, `false`, `0`, or any other value preserves existing behavior):

```text
KEPLERLLM_HIDE_TOOLS_BUTTON=true
KEPLERLLM_HIDE_CREATE_AGENT_BUTTON=true
KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON=true
KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON=true
```

Optionally set the default UI language (default only; an explicit user choice still wins):

```text
DEFAULT_UI_LANGUAGE=pt
```

Used only when no explicit KeplerLLM language preference exists (stored separately in `keplerllmExplicitUILanguage` when the user changes the language through the UI). Must match a supported KeplerLLM locale key (e.g. `en`, `pt`, `es`, `fr`). `pt` selects the existing Brazilian Portuguese translation. `i18nextLng` alone is not treated as an explicit choice, so the default also applies to existing users who never manually selected a language. When unset and no explicit preference exists, the UI falls back to browser language detection with `en` fallback; invalid values are ignored safely. The value is read at container runtime through `window.__KEPLERLLM_CONFIG__`, so no frontend rebuild is needed on CapRover.

Optionally enable the temporary Safari/WebKit cross-origin iframe link-click compatibility workaround (default disabled; not an authentication feature or security boundary; does not change iframe permissions or React Router; disable when Safari/WebKit no longer requires it; runtime-only with no frontend rebuild):

```text
KEPLERLLM_SAFARI_IFRAME_LINK_FIX=true
```

Keep the named volume:

```text
anythingllm-storage -> /app/server/storage
```

No extra volume is required for agent-authored skill drafts; they live under the existing storage volume.

Existing AnythingLLM collector volumes can remain unchanged.
