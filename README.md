<a name="readme-top"></a>

<p align="center">
  <a href="https://ultra-mega-apps.com"><img src="./frontend/public/kepler-llm-dark.png" alt="KeplerLLM logo"></a>
</p>

<p align="center">
    <b>KeplerLLM:</b> The all-in-one AI app you were looking for, tuned for real deployments.<br />
    Chat with your docs, use AI Agents, hyper-configurable, multi-user, & no frustrating setup required.
</p>

<p align="center">
  <a href="https://github.com/fernando-reis-guimaraes/KeplerLLM/blob/main/LICENSE" target="_blank">
      <img src="https://img.shields.io/static/v1?label=license&message=MIT&color=white" alt="License">
  </a> |
  <a href="./KeplerLLM.md" target="_blank">
    Fork changes
  </a> |
  <a href="https://ultra-mega-apps.com" target="_blank">
    Ultra Mega Apps
  </a>
</p>

Chat with your docs. Automate complex workflows with AI Agents. Hyper-configurable, multi-user ready, battle-tested—and runs locally by default with zero setup friction.

### Product Overview

KeplerLLM is a friendly fork of [AnythingLLM by Mintplex Labs](https://github.com/Mintplex-Labs/anything-llm) — the all-in-one AI application that lets you build a private, fully-featured ChatGPT without compromises. Connect your favorite local or cloud LLM, ingest your documents, and start chatting in minutes. Out of the box you get built-in agents, multi-user support, vector databases, and document pipelines — no extra configuration required.

On top of everything upstream provides, KeplerLLM is opinionated about production: sane defaults from environment variables, strict configuration parsing, and deployment-friendly behavior. Every fork-specific change is documented in [`KeplerLLM.md`](./KeplerLLM.md) (and [`KeplerLLM.pt-BR.md`](./KeplerLLM.pt-BR.md) em português), so you always know exactly what differs from upstream and why.

### What is different in this fork

Highlights (full spec in [`KeplerLLM.md`](./KeplerLLM.md)):

- **Default workspace bootstrap from env vars** — a ready-to-use workspace (chat settings, temperature, agent skills) on first boot, no clicking around.
- **Runtime-configurable UI** — default language and visibility of Tools / Quick Actions / Settings buttons via env, great for embedded and customer-facing installs.
- **Strict boolean env parsing** — no more `"false"` surprises; every boolean env var is parsed explicitly.
- **MCP servers via env vars** — declare Model Context Protocol servers with plain `MCP_*` variables, including verbatim header support.
- **Generic OpenAI Responses API mode** — use any OpenAI-compatible Responses endpoint (`GENERIC_OPEN_AI_*`).
- **Dynamic SQLite/PostgreSQL backend** — one Docker image, pick the database with `DATABASE_URL`.
- **Safari-hardened embeds** — cross-origin floating UI and iframe link-click fallbacks for the chat widget and browser extension.
- **Rebranded, self-contained assets** — KeplerLLM wordmark generated deterministically from the repo's own font (`tools/generate-kepler-wordmark.py`); no external design files needed.

### Quick start (Docker)

```bash
cp docker/.env.example docker/.env
# edit docker/.env to taste
docker compose -f docker/docker-compose.yml up --build -d
```

Then open `http://localhost:3001`. See [`docker/HOW_TO_USE_DOCKER.md`](./docker/HOW_TO_USE_DOCKER.md) for details.

### How to setup for development

- `yarn setup` To fill in the required `.env` files you'll need in each of the application sections (from root of repo).
  - Go fill those out before proceeding. Ensure `server/.env.development` is filled or else things won't work right.
- `yarn dev:server` To boot the server locally (from root of repo).
- `yarn dev:frontend` To boot the frontend locally (from root of repo).
- `yarn dev:collector` To then run the document collector (from root of repo).

[Learn about documents](./server/storage/documents/DOCUMENTS.md)

### Technical Overview

This monorepo consists of six main sections:

- `frontend`: A viteJS + React frontend that you can run to easily create and manage all your content the LLM can use.
- `server`: A NodeJS express server to handle all the interactions and do all the vectorDB management and LLM interactions.
- `collector`: NodeJS express server that processes and parses documents from the UI.
- `docker`: Docker instructions and build process + information for building from source.
- `embed`: Submodule with the [web embed widget](https://github.com/fernando-reis-guimaraes/KeplerLLM_Embed).
- `browser-extension`: Submodule with the [browser extension](https://github.com/fernando-reis-guimaraes/KeplerLLM_Browser-Extension).

### Telemetry & Privacy

Like upstream, KeplerLLM contains a telemetry feature that collects anonymous usage information. Set `DISABLE_TELEMETRY` in your server or docker `.env` settings to `"true"` to opt out — you can also do this in-app under sidebar > `Privacy`. See the [upstream telemetry docs](https://github.com/Mintplex-Labs/anything-llm#telemetry--privacy) for exactly what is (and isn't) collected. KeplerLLM adds no telemetry of its own.

### Support

Maintained by [Ultra Mega Apps](https://ultra-mega-apps.com) as a personal open-source portfolio project by [Fernando Reis Guimaraes](https://github.com/fernando-reis-guimaraes).

- Support email: `support@ultra-mega-apps.com`
- WhatsApp: `https://wa.me/13025505015`
- Issues and PRs are welcome here on GitHub.

### Attribution & License

KeplerLLM is a fork of [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) by Mintplex Labs Inc, which carries the upstream feature set, providers, translations, and community work. Thank you to Mintplex Labs and all upstream contributors.

Copyright © 2026 Fernando Reis Guimaraes. <br />
This project is [MIT](./LICENSE) licensed.
