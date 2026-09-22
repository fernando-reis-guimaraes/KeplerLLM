# KeplerLLM

> Canonical specification in English (US). Portuguese version: [KeplerLLM.pt-BR.md](KeplerLLM.pt-BR.md).

KeplerLLM is a fork of AnythingLLM. It preserves upstream behavior except for the fork changes defined below.

The fork adds persistent UI configuration with a single storage volume, a product model label, alphabetical OpenAI model ordering, agent-authored Custom Skill staging with human approval, and dynamic SQLite/PostgreSQL backend selection from a single Docker image.

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

Keep the named volume:

```text
anythingllm-storage -> /app/server/storage
```

No extra volume is required for agent-authored skill drafts; they live under the existing storage volume.

Existing AnythingLLM collector volumes can remain unchanged.
