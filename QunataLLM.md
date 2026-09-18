# KeplerLLM

> Canonical specification in English (US). Portuguese version: [KEPLERLLM.pt-BR.md](KEPLERLLM.pt-BR.md).

KeplerLLM is a fork of AnythingLLM. It preserves upstream behavior except for the fork changes defined below.

The fork adds persistent UI configuration with a single storage volume, a product model label, alphabetical OpenAI model ordering, and agent-authored Custom Skill staging with human approval.

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

## Appendix - Operational reference

This appendix records only the runtime and publishing facts needed to operate the fork. It does not describe implementation.

### Supported upstream baseline

The fork tracks a stable AnythingLLM baseline. The current baseline is:

```text
1.16.1
```

### Runtime configuration

| Variable                       | Default               | Behavior                                                        |
| ------------------------------ | --------------------- | --------------------------------------------------------------- |
| `STORAGE_DIR`                  | `/app/server/storage` | Standard storage volume. Holds UI configuration and skill data. |
| `KEPLERLLM_MODEL_DISPLAY_NAME` | `Kepler AI`           | Product label shown in the workspace model picker.              |

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
