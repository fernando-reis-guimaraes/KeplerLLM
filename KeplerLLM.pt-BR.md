# KeplerLLM

> Tradução em português. Especificação canônica em inglês (US): [KeplerLLM.md](KeplerLLM.md).

KeplerLLM é um fork do AnythingLLM. Preserva o comportamento upstream, exceto pelas fork changes definidas abaixo.

O fork adiciona persistent UI configuration com um único storage volume, product model label, alphabetical OpenAI model ordering, agent-authored Custom Skill staging com human approval, dynamic SQLite/PostgreSQL backend selection a partir de uma única Docker image e um optional OpenAI-compatible Responses API mode para o Generic OpenAI provider.

## Fork changes

Esta seção define o fork delta. Cada requirement descreve observable behavior. Não prescreve implementation.

### Requirement 1 - Persistent UI configuration

#### Objective

Manter a configuration gerenciada pela AnythingLLM UI entre restarts e redeploys usando apenas o standard storage volume.

#### Observable behavior

- O deployment monta apenas o standard storage volume em `/app/server/storage`.
- A configuration gerenciada pela UI persiste em `${STORAGE_DIR}/.env` e permanece disponível para o server como `/app/server/.env`.
- No first boot, quando não existe persistent configuration, o server inicia a partir da default configuration entregue na image.
- Alterações feitas pela AnythingLLM UI persistem entre restarts.
- O storage directory é criado quando ausente.
- O startup falha com um erro claro quando a persistent configuration não permite escrita.

#### Rules and limits

- O seeding a partir do default da image acontece somente quando o persistent file ainda não existe.
- Nenhum file mount separado ou bind mount é exigido para a UI configuration.

#### Out of scope

- Versionamento, merge ou migração de configuration values.
- Persistência de arquivos fora do standard storage volume.

### Requirement 2 - Product model label

#### Objective

Exibir um product label no lugar do model identifier original onde o workspace model picker estiver visível.

#### Observable behavior

- O workspace model picker exibe um label KeplerLLM em vez do raw provider ou model identifier.
- O default label é:

```text
Kepler AI
```

- Operators podem sobrescrever o label em runtime com:

```text
KEPLERLLM_MODEL_DISPLAY_NAME=Your Name Here
```

- O label configurado fica disponível a cada boot sem rebuild da image.
- Um override vazio ou contendo apenas espaços retorna para a resolução de model name do upstream.
- O label vale onde o picker está visível, como single-user mode e admin sessions. A visibilidade para non-admin em multi-user mode continua regida pelo comportamento upstream.

#### Rules and limits

- Mudança apenas de display. Provider selection, model selection, API requests e billing permanecem inalterados.

#### Out of scope

- Renomear providers, models ou router entries em settings ou APIs.
- Ocultar ou alterar quais models um workspace pode selecionar.

### Requirement 3 - Alphabetical OpenAI model ordering

#### Objective

Facilitar a localização de snapshots OpenAI relacionados, mantendo o grouping por organization e ordenando os models em ordem alfabética dentro de cada grupo.

#### Observable behavior

- Os OpenAI models permanecem agrupados por organization.
- Os models dentro de cada organization group aparecem em ordem alfabética por model name.
- Por exemplo, snapshots como:

```text
gpt-4o-2024-05-13
gpt-4o-2024-08-06
gpt-4o-2024-11-20
```

aparecem juntos em ordem lexical em vez de herdar a API response order.

#### Rules and limits

- Mudança apenas de display. Model IDs, provider behavior, API requests e o selected model permanecem inalterados.

#### Out of scope

- Ordenar models de outros providers.
- Alterar o organization grouping ou a default selection.

### Requirement 4 - Agent-authored Custom Skill staging

#### Objective

Permitir que o agent crie rascunhos (drafts) de Custom Skill sem conceder a ele write access às installed executable skills. Um humano aprova os drafts antes da execução.

O lifecycle é:

```text
WRITE -> REVIEW -> EXECUTE
```

em vez de:

```text
WRITE -> EXECUTE
```

#### Observable behavior

- O File System Access permanece confinado a:

```text
${STORAGE_DIR}/anythingllm-fs
```

- Os drafts criados pelo agent ficam em:

```text
${STORAGE_DIR}/anythingllm-fs/agent-skills/<hubId>
```

- Um draft usa o layout normal de Custom Skill do AnythingLLM:

```text
anythingllm-fs/agent-skills/send-email/
├── plugin.json
├── handler.js
└── README.md
```

- As installed executable skills permanecem em:

```text
${STORAGE_DIR}/plugins/agent-skills
```

- A skill list exibe tanto as installed skills quanto os drafts. Drafts aparecem com status `Pending review`.
- Um draft é sempre reportado como inactive, mesmo quando seu `plugin.json` contém `"active": true`.
- Drafts não são carregáveis pelo agent runtime e são excluídos da Scheduled Job tool selection.
- Habilitar um draft pelo admin Custom Skill toggle promove (promote) o draft para o executable directory e o marca como active.
- Após a promotion, o File System Access já não consegue modificar a skill.
- Excluir (delete) uma skill funciona tanto para uma installed skill quanto para um pending draft.

#### Rules and limits

- A promotion acontece somente por ativação explícita no admin Custom Skill toggle. Escrever `active: true` no arquivo do draft não o torna executável.
- Editar um draft sem ativá-lo o mantém inactive e preserva a folder identity.
- Identity e review markers enviados via API não conseguem escalar um draft.
- A promotion falha em vez de sobrescrever quando a folder identity diverge do `plugin.json`, quando o `handler.js` está ausente, ou quando já existe uma installed skill com a mesma identity.
- Quando a mesma identity existe nos dois locais, a installed copy prevalece.
- Pastas sem uma identidade legível em `plugin.json` são ignoradas.
- Community Hub imports permanecem imediatamente administrative e não passam pelo draft review.
- Ambos os skill directories são criados automaticamente quando necessário.

#### Out of scope

- Review, teste ou sandbox automáticos de drafts.
- Histórico de versões ou rollback de promoted skills.
- Alterar a semântica de execução de Custom Skill do upstream após a promotion.

#### Authoring workflow

1. Habilite **Agent Skills -> File System Access**.
2. Habilite as file operations necessárias para autoria, normalmente criação de diretórios, escrita, edição, leitura e listagem.
3. Peça ao agent para criar a skill sob `agent-skills/<hubId>` dentro do seu File System Access root.
4. Revise o `plugin.json`, o `handler.js` e os supporting files gerados.
5. Abra **Settings -> Agent Skills -> Custom Skills**.
6. O draft aparece como **Pending review**.
7. Habilite o draft para promovê-lo ao executable Custom Skill directory.

Exemplo de solicitação:

```text
Create a Custom Agent Skill named send-email under agent-skills/send-email.
Use the standard AnythingLLM plugin.json + handler.js layout.
Do not put credentials in source files.
Leave the skill inactive for review.
```

### Requirement 5 - Product name in user-visible text

#### Objective

Apresentar o KeplerLLM como product name em todos os lugares visíveis ao user, mantendo todos os technical contracts idênticos ao upstream.

#### Observable behavior

- UI strings, titles, descriptions, help texts, notification defaults, o browser tab title e o PWA manifest exibem KeplerLLM em vez de AnythingLLM.
- Os generated artifacts carregam o branding KeplerLLM (exported chats, office documents, chat widget defaults).
- As bot messages e a developer API documentation são intituladas KeplerLLM.
- Os external product links apontam para as propriedades KeplerLLM: o ícone GitHub leva a `https://github.com/ultra-mega-apps`, as docs and support pages levam a `https://ultra-mega-apps.com`, o Discord invite é substituído pelo WhatsApp em `https://wa.me/13025505015` e o default support email é `support@ultra-mega-apps.com`. O onboarding survey endpoint não reporta mais ao upstream.

#### Rules and limits

- Mudança apenas de texto. Package names, imports, identifiers, file paths, storage keys, localStorage keys, API routes, request/response contracts, provider slugs (incluindo `anythingllm-router`) e integration header tokens permanecem inalterados. Os functional upstream service endpoints permanecem em suas URLs originais.
- As functional service integrations continuam funcionando: model downloads do upstream CDN, Community Hub imports e profile links, e o Docker Chromium download permanecem nos upstream endpoints.
- O logo artwork e os static media assets permanecem inalterados.
- O embed widget e a browser extension vivem em repositórios forked (`frginbox/KeplerLLM_Embed`, `frginbox/KeplerLLM_Browser-Extension`, com personal forks sob `fernando-reis-guimaraes/`), conectados como git submodules. Seu committed widget build sob `frontend/public/embed/` é regenerado a partir do forked embed source.
- Não existem product email templates no codebase; a regra se aplica às bot and notification messages.

#### Out of scope

- Renomear upstream services, repositories ou documentation URLs.
- Alterar os Community Hub imports, que permanecem administrativos.

### Requirement 6 - Dynamic database backend selection

#### Objective

Executar a mesma Docker image do KeplerLLM com SQLite ou PostgreSQL, selecionando o backend no startup do container.

#### Observable behavior

- Quando `DATABASE_URL` está ausente ou vazia, o KeplerLLM usa SQLite em:

```text
/app/server/storage/anythingllm.db
```

O comportamento SQLite existente e o data location permanecem inalterados.

- Quando `DATABASE_URL` contém `postgresql://...` ou `postgres://...`, o KeplerLLM usa PostgreSQL através de `DATABASE_URL`.
- Neon é um standard PostgreSQL provider compatível. A implementação é PostgreSQL genérica e não é específica da Neon. Exemplo:

```text
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
```

- O startup registra uma das linhas:

```text
Database backend: SQLite
Database backend: PostgreSQL
```

O valor completo de `DATABASE_URL` e sua password nunca são registrados em log.

- Se `DATABASE_URL` está definida mas não usa um PostgreSQL URI scheme, o startup falha de forma clara antes do application start e não usa SQLite como fallback.
- `STORAGE_DIR` continua exigido mesmo com PostgreSQL porque o KeplerLLM guarda non-database files nesse local.
- As migrations usam `prisma migrate deploy`, não `prisma db push`. SQLite usa `server/prisma/schema.prisma` e `server/prisma/migrations/`. PostgreSQL usa `server/prisma/postgresql/schema.prisma` e `server/prisma/postgresql/migrations/`.
- Adicionar `DATABASE_URL` seleciona o backend PostgreSQL; isso não copia dados de um SQLite database existente. Remover `DATABASE_URL` depois seleciona novamente o SQLite database anterior se o arquivo ainda existir. Não há data migration automática entre backends.

#### Rules and limits

- SQLite permanece o default. Users sem `DATABASE_URL` não observam mudança de comportamento ou de data location.
- Existe uma única Docker image e tag stream. Não há uma KeplerLLM image `:pg` separada.
- A backend selection acontece no container startup em `docker/docker-entrypoint.sh`, antes do Prisma generate e migrate.
- `server/prisma/schema.prisma` e `server/prisma/postgresql/schema.prisma` devem permanecer model-compatible. Apenas o datasource provider e os provider-specific header comments podem diferir.
- A parity é garantida por `scripts/check-prisma-parity.cjs` (`yarn prisma:parity`) e `server/__tests__/prisma/schemaParity.test.js` (executado com `yarn test`).
- O PostgreSQL migration history vem do upstream oficial `Mintplex-Labs/anything-llm`, branch `pg` (reference commit `93317de1880afccdace2c75ce83ba1281361eff1`), adaptado apenas quando necessário para o schema atual do KeplerLLM.

#### Out of scope

- Data migration automática de SQLite para PostgreSQL.
- Uma segunda Docker image ou tag para PostgreSQL.
- Comportamento específico da Neon além da standard PostgreSQL compatibility.

### Requirement 7 - Generic OpenAI Responses API mode

#### Objective

Permitir que o Generic OpenAI provider (`LLM_PROVIDER=generic-openai`) use endpoints OpenAI-compatible Responses API (`POST /responses`) em vez de Chat Completions (`POST /chat/completions`), selecionado inteiramente por environment variable, sem mudar o comportamento das instalações existentes.

#### Observable behavior

- Quando `GENERIC_OPEN_AI_API_MODE` está ausente, o provider usa `chat-completions`, exatamente como antes desta mudança.
- Quando definido como `chat-completions`, o comportamento não muda.
- Quando definido como `responses`, normal chat, streaming chat e native agent/MCP tool calling rodam contra a Responses API através do official OpenAI SDK (`responses.create`).
- Resultados de Responses (text, reasoning, tool calls, token usage, metrics) são normalizados para os existing internal contracts, de modo que chat, streaming e o agent loop funcionam sem branches protocol-specific downstream.
- Durante a execução multi-turn de agent tools, o provider encadeia o Responses continuation identifier dentro do active run quando o provider suporta, e tenta uma vez stateless quando o provider o rejeita.
- Um valor inválido gera um warning claro e retorna para `chat-completions`.
- No startup, o provider registra o protocolo selecionado (sem credentials):

```text
[GenericOpenAiLLM] Inference API: https://api.meta.ai/v1 Model: muse-spark-1.3-contributor API mode: responses
```

Exemplo de configuração:

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

- Configuração apenas por environment variable. Não há UI setting para o protocol mode.
- `chat-completions` continua o default; instalações existentes sem a nova variável não observam mudança de comportamento.
- O provider precisa suportar a Responses API; backends apenas Chat Completions continuam funcionando pelo default mode.
- O Responses mode é particularmente útil para agentic workloads e providers com suporte a reasoning continuity.
- No Responses mode, `GENERIC_OPEN_AI_MAX_TOKENS` mapeia para `max_output_tokens`, o Responses usage (`input_tokens`/`output_tokens`/`total_tokens`) mapeia para as existing prompt/completion/total metrics, e `temperature` é omitido dos Responses requests porque deployments Responses-only de reasoning comumente o rejeitam. O Chat Completions mode continua enviando `temperature` exatamente como antes.
- O model discovery (`/v1/models` via `models.list()`) não muda, e `GENERIC_OPEN_AI_MODEL_PREF` ainda pode nomear um model que o `/models` não lista.
- A implementation relevante vive em `server/utils/AiProviders/genericOpenAi/` (protocol adapters compartilhados em `responses.js`) e `server/utils/agents/aibitat/providers/genericOpenAi.js`. O AIbitat agent loop em si não muda.

#### Out of scope

- Suporte a providers que não sejam OpenAI-compatible.
- Persistir Responses continuation identifiers entre conversations; o chaining state limita-se ao active agent run.

## Appendix - Operational reference

Este apêndice registra apenas os fatos de runtime e publishing necessários para operar o fork. Não descreve implementation.

### Supported upstream baseline

O fork acompanha um stable AnythingLLM baseline. O baseline atual é:

```text
1.16.1
```

### Runtime configuration

| Variable                       | Default               | Behavior                                                                                |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------- |
| `STORAGE_DIR`                  | `/app/server/storage` | Standard storage volume. Guarda UI configuration e skill data. Ainda exigido com PostgreSQL. |
| `KEPLERLLM_MODEL_DISPLAY_NAME` | `Kepler AI`           | Product label exibido no workspace model picker.                                        |
| `DATABASE_URL`                 | unset                 | Quando ausente, usa SQLite. Quando contém `postgresql://...`, usa PostgreSQL.           |
| `GENERIC_OPEN_AI_API_MODE`     | `chat-completions`    | Protocolo do Generic OpenAI: `chat-completions` (default) ou `responses` (Responses API). |

O deployment monta apenas:

```text
/app/server/storage
```

Nenhum volume extra é exigido para drafts de agent-authored skill; eles ficam sob o existing storage volume.

### Build and publish

`.envrc` define `IMAGE_TAG` a partir do short Git commit hash atual. `compose.yaml` publica tanto essa immutable tag quanto `latest`.

Após commitar ou puxar mudanças, defina `IMAGE_TAG` a partir do `HEAD` atual antes do build, para que um bloco multi-comando colado não reaproveite um valor stale do direnv:

```bash
export IMAGE_TAG="$(git rev-parse --short HEAD)"
docker compose build --push
```

Published images:

```text
cr.umapps.net/umapps/keplerllm:${IMAGE_TAG}
cr.umapps.net/umapps/keplerllm:latest
```

O build do Compose contempla `linux/amd64` e `linux/arm64`.

## CapRover

Use:

```text
STORAGE_DIR=/app/server/storage
```

Para PostgreSQL, defina também:

```text
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
```

Quando `DATABASE_URL` está ausente, o SQLite é usado em `/app/server/storage/anythingllm.db`. Adicioná-la alterna para PostgreSQL sem migrar dados do SQLite. Removê-la seleciona novamente o SQLite se o arquivo ainda existir. `STORAGE_DIR` continua exigido com PostgreSQL.

Opcionalmente personalize o model label:

```text
KEPLERLLM_MODEL_DISPLAY_NAME=Kepler AI
```

Mantenha o named volume:

```text
anythingllm-storage -> /app/server/storage
```

Nenhum volume extra é exigido para drafts de agent-authored skill; eles ficam sob o existing storage volume.

Existing AnythingLLM collector volumes podem permanecer inalterados.
