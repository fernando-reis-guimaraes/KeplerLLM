# AGENTS.md

## Fork documentation rule

KeplerLLM is a thin fork/overlay on top of AnythingLLM. Keep the fork delta explicit and documented.

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
- Upgrade/maintenance implications, especially exact-source patch anchors that may fail after an upstream upgrade.

Pure formatting, spelling, comment-only changes, or internal refactors that do not alter fork behavior do not require a new README entry.

Documentation and code comments must be written in English (US).
