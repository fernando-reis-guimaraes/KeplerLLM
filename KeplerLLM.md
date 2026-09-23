# KeplerLLM

> Canonical specification in English (US). Portuguese version: [KeplerLLM.pt-BR.md](KeplerLLM.pt-BR.md).

KeplerLLM is a fork of AnythingLLM. It preserves upstream behavior except for the fork changes defined below.

The fork adds persistent UI configuration with a single storage volume, a product model label, alphabetical OpenAI model ordering, agent-authored Custom Skill staging with human approval, dynamic SQLite/PostgreSQL backend selection from a single Docker image, an optional OpenAI-compatible Responses API mode for the Generic OpenAI provider, and remote MCP server configuration through environment variables.

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

#### Rules and limits

- Text-only change. Package names, imports, identifiers, file paths, storage keys, localStorage keys, API routes, request/response contracts, provider slugs (including `anythingllm-router`), and integration header tokens remain unchanged. Functional upstream service endpoints stay on their original URLs.
- Functional service integrations keep working: model downloads from the upstream CDN, Community Hub imports and profile links, and the Docker Chromium download stay on upstream endpoints.
- Logo artwork and static media assets are unchanged.
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

Keep the named volume:

```text
anythingllm-storage -> /app/server/storage
```

No extra volume is required for agent-authored skill drafts; they live under the existing storage volume.

Existing AnythingLLM collector volumes can remain unchanged.
