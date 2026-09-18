# AGENTS.md

## Fork documentation rule

KeplerLLM is a thin fork on top of AnythingLLM. Keep the fork delta explicit and documented.

Whenever you make a KeplerLLM-specific change, update `KeplerLLM.md` and `KeplerLLM.pt-BR.md` in the same change/commit so the **Fork changes** section accurately documents the current behavior.

This includes, at minimum:

- UI or branding changes.
- Server-side behavior changes.
- Build or Docker changes.
- Deployment or storage conventions.
- Agent, tool, Custom Skill, MCP, or Scheduled Job behavior.
- Security boundaries or approval flows.
- Upstream patches, compatibility assumptions, or version-specific workarounds.

Do not leave a fork-specific behavioral change documented only in source code, commit messages, or chat history.

For each documented fork change, record the important operational details when relevant:

- What differs from upstream AnythingLLM.
- Why the fork changes it.
- Relevant paths, environment variables, or configuration.
- Security implications or trust boundaries.
- Upgrade or maintenance implications, especially source-level assumptions that may fail after an upstream upgrade.

Pure formatting, spelling, comment-only changes, or internal refactors that do not alter fork behavior do not require a new documentation entry.

## Language policy

English (US) is the canonical language of the project.

### Source code

All source code must be written in English, including:

- Variable, function, class, method, type, and constant names.
- File and directory names created by the fork, unless an external convention requires otherwise.
- Code comments.
- Log messages intended for developers or operators.
- Internal error messages.
- Test names, fixtures, and test descriptions.
- Configuration keys and environment variable names.

Do not introduce Portuguese identifiers into the source code.

### Database

When the project introduces or controls a database schema, the schema must be written in English.

This includes:

- Table names.
- Column names.
- Views.
- Indexes.
- Constraints.
- Enum values when they are part of the technical schema.
- Stored procedures, functions, triggers, and other database objects.
- Migration names and migration source code.

User-visible localized content stored in the database is exempt from this rule when localization is part of the product behavior.

### Documentation

Canonical project documentation must be written in English (US).

When a Portuguese version exists, it must be a translation of the English canonical document.

For the main fork specification:

- `KeplerLLM.md` is the official canonical document.
- `KeplerLLM.pt-BR.md` is its Brazilian Portuguese translation.

Both files must describe the same behavior. When behavior changes, update the English canonical version first and update the PT-BR translation in the same change/commit.

The Portuguese version must not introduce requirements, behavior, or decisions that are absent from the English canonical version. If the two versions conflict, the English version is authoritative.

Apply the same convention to other paired project documentation whenever both English and PT-BR versions are maintained.

### Conversation and agent interaction

Conversation with the project owner may be in Brazilian Portuguese.

When communicating in Portuguese:

- Keep technical terms in English when that is their established project or industry name.
- Keep code, identifiers, commands, paths, configuration keys, environment variables, API names, database object names, and filenames in English.
- Do not translate technical identifiers merely to make prose Portuguese.
- Prefer natural PT-BR prose around the original English technical terminology.

Agents may reason about and discuss implementation in Portuguese, but artifacts committed to the repository must follow the language rules above.

## Canonical-language rule

When there is any ambiguity between an English artifact and its translated PT-BR counterpart:

1. Treat the English version as canonical.
2. Correct the English version first.
3. Synchronize the PT-BR translation with it.
4. Do not resolve discrepancies by changing only the translated version.
