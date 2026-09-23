# KeplerLLM

> Tradução em português. Especificação canônica em inglês (US): [KeplerLLM.md](KeplerLLM.md).

KeplerLLM é um fork do AnythingLLM. Preserva o comportamento upstream, exceto pelas fork changes definidas abaixo.

O fork adiciona persistent UI configuration com um único storage volume, product model label, alphabetical OpenAI model ordering, agent-authored Custom Skill staging com human approval, dynamic SQLite/PostgreSQL backend selection a partir de uma única Docker image, um optional OpenAI-compatible Responses API mode para o Generic OpenAI provider, remote MCP server configuration através de environment variables e default workspace bootstrap a partir de environment variables.

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
- Os logo wordmarks exibem KeplerLLM em vez de AnythingLLM. Os pixels do infinity icon são preservados. `Kepler` mantém a cor original do wordmark (branco `#FFFFFF` em fundos escuros, escuro `#222628` em fundos claros) e `LLM` usa azul `#2E90FA`. Canvas size, proporções, transparência e layout permanecem inalterados.

#### Rules and limits

- Mudança apenas de texto. Package names, imports, identifiers, file paths, storage keys, localStorage keys, API routes, request/response contracts, provider slugs (incluindo `anythingllm-router`) e integration header tokens permanecem inalterados. Os functional upstream service endpoints permanecem em suas URLs originais.
- As functional service integrations continuam funcionando: model downloads do upstream CDN, Community Hub imports e profile links, e o Docker Chromium download permanecem nos upstream endpoints.
- Os logo filenames, file paths, canvas sizes, transparência e pixels do infinity icon permanecem inalterados para compatibilidade com o upstream; apenas os pixels do wordmark foram alterados para KeplerLLM (`Kepler` em `#FFFFFF` ou `#222628`, `LLM` em `#2E90FA`, Plus Jakarta Sans). Os assets apenas com ícone (`anything-llm-icon.png`, `anything-llm-infinity.png`, favicons) permanecem inalterados. Os logos em `frontend/dist/` são build output gerado e são regenerados no build.
- Arquivos de wordmark com rebrand: `frontend/src/media/logo/anything-llm.png`, `frontend/src/media/logo/anything-llm-dark.png`, `frontend/public/anything-llm-light.png`, `frontend/public/anything-llm-dark.png`, `server/storage/assets/anything-llm.png`, `server/storage/assets/anything-llm-invert.png`, `server/utils/agents/aibitat/plugins/create-files/assets/anything-llm.png`, `server/utils/agents/aibitat/plugins/create-files/assets/anything-llm-invert.png`, `open-computer/services/public/anythingllm-wordmark.png`, além dos arquivos de submodule `embed/src/assets/anything-llm-dark.png` e `browser-extension/src/media/anything-llm.png`. Nota de upgrade: updates de logo no upstream vão conflitar; reaplicar a renderização do wordmark KeplerLLM ao fazer merge.
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
- Requests encadeados de continuation enviam apenas o input recém-produzido (por exemplo só o `function_call_output`); o retry stateless reenvia o histórico completo reconstruído para que o request continue independentemente válido. O continuation state nunca sai do active agent run.
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

### Requirement 8 - Remote MCP servers através de environment variables

#### Objective

Definir remote Streamable HTTP MCP servers com uma environment variable por server, sem JSON dentro de envvars, reutilizando o existing MCP Hypervisor e o maquinário MCP/AIbitat.

#### Observable behavior

- Cada server é definido como:

```text
MCP_<NAME>=<URL>[|<AUTH_OR_HEADER>...]
```

- Exemplos (credentials fictícias):

```env
MCP_CLASSLOG_BANCO_DADOS=https://mcp-pg.example.com/XXX/mcp
MCP_CLASSLOG_BANCO_DADOS=https://mcp-pg.example.com/XXX/mcp|Bearer|TOKEN
MCP_CLASSLOG_CODIGO_FONTE=https://src.example.com/XXX/mcp|Basic|Usuario:Senha
MCP_OUTRO=https://example.com/mcp|X-USER|XXX|X-PASS|YYY
MCP_OUTRO=https://example.com/mcp|Bearer|TOKEN|X-USER|Fernando|X-APP|Classlog
```

- A parte após `MCP_` vira o server name: remove o prefixo, lowercase, troca `_` por `-`. Por exemplo `MCP_CLASSLOG_BANCO_DADOS` vira `classlog-banco-dados`.
- Environment definitions são sempre remote Streamable HTTP servers. Não é preciso informar `type`.
- Gramática suportada:

```text
<URL>
<URL>|Bearer|<TOKEN>
<URL>|Basic|<USERNAME>:<PASSWORD>
<URL>|<HEADER>|<VALUE> [...]
<URL>|Bearer|<TOKEN>|<HEADER>|<VALUE> [...]
<URL>|Basic|<USERNAME>:<PASSWORD>|<HEADER>|<VALUE> [...]
```

- `Bearer` e `Basic` são case-insensitive na posição de auth. `Bearer` gera `Authorization: Bearer <TOKEN>` com a grafia canônica. `Basic` recebe exatamente um valor `Username:Password`, com split apenas no primeiro `:`, de modo que o password pode conter dois-pontos adicionais, e gera `Authorization: Basic <base64>`.
- Qualquer outra coisa é um par comum `<HEADER>|<VALUE>` até o fim do valor. Header names e values são preservados verbatim (casing e espaçamento exatos; sem trimming). Só `Bearer` e `Basic` são especiais.
- `|` é o delimitador reservado. Não há escaping, quoting ou sintaxe `\|`. Valores com `|` literal não são suportados.
- A discovery é conservadora: uma variável `MCP_*` só vira server quando o valor começa com uma URL válida `http://` ou `https://`. Flags como `MCP_NO_COOLDOWN` nunca viram servers.
- A configuração efetiva é `anythingllm_mcp_servers.json` com merge das definições `MCP_*` a cada load/reload. O environment vence por server name. Um nome definido pelo environment sombreia o mesmo nome em `anythingllm_mcp_servers.json` mesmo quando a definição do environment é inválida, de modo que uma envvar malformada relata um erro de configuração do environment em vez de voltar silenciosamente à configuração stale do arquivo. Environment definitions nunca são escritas no JSON file. Remover uma envvar restaura a definição do arquivo no próximo reload/restart.
- Uma definição `MCP_*` inválida falha apenas aquele server, com mensagem útil per-server. Nunca derruba o boot nem oculta os demais servers.

#### Rules and limits

- Configuração apenas por environment variable. Não há JSON env configuration nem sprawl além de uma variável por server.
- Environment-managed servers aparecem na lista MCP com `source: "environment"`, status running/error/tools normal e comportamento start/stop/reload normal. O Delete permanente é rejeitado para eles; altere as envvars do deployment.
- Toggles de tool-suppression para environment-managed servers persistem apenas metadata segura `anythingllm` (`suppressedTools`, `autoStart`). URLs, tokens, passwords e header values nunca vão para o JSON file por causa disso.
- O frontend/API nunca recebe URLs completas, paths, query strings, fragments, credentials embutidas na URL, tokens, passwords, valores `Authorization`, header values arbitrários ou valores originais `MCP_*`. Só hostname/domain (via URL parsing), transport type, source, header names, metadata segura `anythingllm`, status, tools e erros sanitizados são expostos. Essa redação vale também para servers file-managed.
- Logs e mensagens de erro identificam servers só pelo nome normalizado e hostname seguro. Erros de transporte são sanitizados antes de logar ou retornar à UI.
- A implementation relevante vive em `server/utils/MCP/env.js` (helpers puros de parser/merge/sanitizer), `server/utils/MCP/hypervisor/index.js` (config efetiva, boot/logging secret-safe), `server/utils/MCP/index.js` (`servers()` sanitizado, guarda de delete environment-managed) e `frontend/src/pages/Admin/Agents/MCPServers/` (indicador de environment, exibição de config redigida).
- Nenhum novo MCP transport, Hypervisor, config file ou agent framework foi introduzido.

### Requirement 9 - Default workspace bootstrap a partir de environment variables

#### Objective

Provisionar o default AnythingLLM workspace no first boot a partir de environment variables, sem shell hacks, chamadas de API externas, curl de startup, scripts SQL diretos ou bypass dos models/services existentes do AnythingLLM.

#### Observable behavior

- Quando nenhuma variavel DEFAULT_WORKSPACE esta definida, o comportamento e exatamente o upstream AnythingLLM behavior.
- Quando qualquer variavel DEFAULT_WORKSPACE esta definida, o server garante que o workspace configurado exista durante a application initialization e depois trata o database como source of truth.
- Se o workspace configurado nao existir, ele e criado atraves da existing Workspace model layer com os valores fornecidos e persistido normalmente em SQLite ou PostgreSQL.
- Se o workspace ja existir, o bootstrap nao sobrescreve valores alterados pela UI ou API. Restart ou redeploy do mesmo container e idempotente e nunca cria duplicatas.
- DEFAULT_WORKSPACE_SLUG, quando explicitamente fornecido, identifica o workspace. Quando omitido, o existing AnythingLLM slug-generation behavior e usado.
- DEFAULT_WORKSPACE_CHAT_MODE mapeia para o workspace chatMode. Valores aceitos: chat, query e automatic.
- DEFAULT_WORKSPACE_TEMPERATURE mapeia para o workspace openAiTemp. Deve ser um number >= 0.
- DEFAULT_WORKSPACE_HISTORY mapeia para o workspace openAiHistory. Deve ser um integer >= 0.
- Valores numericos usam strict parsing. Por exemplo DEFAULT_WORKSPACE_TEMPERATURE=foo e DEFAULT_WORKSPACE_HISTORY=abc falham no startup com actionable configuration error em vez de coercao silenciosa.
- Todas as variaveis exceto o workspace name sao opcionais. Por exemplo DEFAULT_WORKSPACE_NAME mais DEFAULT_WORKSPACE_SLUG sem system prompt e valido, e DEFAULT_WORKSPACE_NAME mais system prompt sem slug usa a normal slug generation. Variaveis unset preservam os defaults do AnythingLLM. Uma variavel unset nunca vira empty database value.
- Quando qualquer variavel DEFAULT_WORKSPACE esta definida mas DEFAULT_WORKSPACE_NAME falta, o startup falha com erro claro indicando a variavel requerida.

#### System prompt sources

Tres fontes sao suportadas com precedencia sobre valores nao vazios: FILE nao vazio maior que BASE64 nao vazio maior que plain.

Um DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE ou DEFAULT_WORKSPACE_SYSTEM_PROMPT_BASE64 vazio ou com apenas whitespace comporta-se como nao configurado, de modo que uma variavel opcional declarada mas deixada vazia (comum em Docker/CapRover) nunca sombreia uma fonte de precedencia menor que esteja utilizavel. Um valor nao vazio invalido ainda falha no startup de forma clara, sem fallback.

Simple prompt:

```env
DEFAULT_WORKSPACE_NAME=Kepler
DEFAULT_WORKSPACE_SLUG=kepler
DEFAULT_WORKSPACE_SYSTEM_PROMPT="You are Kepler AI."
DEFAULT_WORKSPACE_CHAT_MODE=chat
DEFAULT_WORKSPACE_TEMPERATURE=1
DEFAULT_WORKSPACE_HISTORY=20
```

O valor plain-text e usado verbatim. Whitespace e newlines sao preservados exatamente.

Base64 prompt:

```env
DEFAULT_WORKSPACE_SYSTEM_PROMPT_BASE64=<base64-value>
```

Gere o valor com um comando portatil:

```bash
base64 < system-prompt.txt | tr -d '\n'
```

No macOS o base64 quebra linhas por padrao; o pipe com tr produz a forma single-line esperada em environment variables. No GNU/Linux sem -w0 tambem ha quebra, entao o mesmo comando portatil funciona nas duas plataformas. O decoder tambem ignora ASCII whitespace, entao output com quebras ainda decodifica.

Base64 e decodificado como standard Base64 para UTF-8. O conteudo decodificado vira o workspace openAiPrompt exatamente, com whitespace e newlines preservados. Base64 malformado falha no startup com actionable error e nunca faz fallback silencioso para a variavel plain-text. Bytes decodificados que nao sao UTF-8 valido falham no startup com actionable error.

File prompt:

```env
DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE=/run/secrets/kepler-system-prompt.txt
```

O file e lido como UTF-8 e armazenado verbatim. O file deve existir e ser legivel; UTF-8 invalido produz clear startup error. Este modo evita limits de tamanho de environment variables do sistema operacional e suporta Docker/Kubernetes secret files.

#### Size handling

Nenhum application-level prompt limit desnecessariamente pequeno e imposto. Prompts nunca sofrem truncate. O Linux impoe limits praticos em environment strings individuais e o Base64 aumenta o payload em aproximadamente 33 porcento. A guidance operacional recomendada e manter system prompts decodificados em ate aproximadamente 64 KiB no modo plain/Base64 e usar DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE para prompts substancialmente maiores.

#### Rules and limits

- Bootstrap-only: environment variables nao sao continuamente authoritative. Elas nunca sobrescrevem database values no restart.
- A concurrent initialization normalmente nao cria workspaces duplicados. A criacao com slug explicito e atomica; a criacao sem slug explicito reutiliza a upstream slug generation e recupera de unique-constraint races reutilizando o workspace existente.
- As existing Workspace validation rules e accepted values sao reutilizadas. Nenhum slug algorithm separado incompativel e introduzido e nenhuma database schema change e necessaria.
- O system prompt e potentially sensitive configuration. Seu conteudo, e o valor Base64 completo, nunca sao emitidos em normal logs. O startup registra apenas safe metadata, por exemplo workspace=kepler, systemPromptSource=base64 e systemPromptBytes=18432.

#### Out of scope

- Tornar environment variables permanentemente authoritative sobre a workspace configuration.
- Migracao automatica de dados de qualquer tipo.
- Alterar a existing AnythingLLM workspace creation, UI-created workspaces, API-created workspaces, migrations ou upstream defaults.


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
| `MCP_<NAME>`                   | unset                 | Um remote Streamable HTTP MCP server por variável, ex. `MCP_DOCS=https://host/XXX/mcp`. O env vence o MCP JSON file. |
| `DEFAULT_WORKSPACE_NAME`       | unset                 | Nome do workspace de bootstrap. Exigido quando qualquer `DEFAULT_WORKSPACE_*` esta definida. |
| `DEFAULT_WORKSPACE_SLUG`       | unset                 | Slug do workspace de bootstrap. Quando definida, identifica o workspace. Sem ela, usa slug generation. |
| `DEFAULT_WORKSPACE_SYSTEM_PROMPT` | unset              | System prompt como texto plain, verbatim. Precedencia mais baixa. |
| `DEFAULT_WORKSPACE_SYSTEM_PROMPT_BASE64` | unset       | System prompt como Base64 UTF-8 padrao. Precedencia intermediaria. |
| `DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE` | unset         | System prompt como caminho de arquivo UTF-8. Precedencia mais alta. |
| `DEFAULT_WORKSPACE_CHAT_MODE`  | unset                 | chatMode de bootstrap: chat, query ou automatic. Unset preserva o default. |
| `DEFAULT_WORKSPACE_TEMPERATURE` | unset                | openAiTemp de bootstrap como number >= 0. Unset preserva o default. |
| `DEFAULT_WORKSPACE_HISTORY`    | unset                 | openAiHistory de bootstrap como integer >= 0. Unset preserva o default. |

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

Opcionalmente defina remote MCP servers (uma variável por server, Streamable HTTP, valores fictícios):

```text
MCP_DOCS=https://mcp.example.com/XXX/mcp
MCP_DOCS=https://mcp.example.com/XXX/mcp|Bearer|TOKEN
MCP_CODE=https://src.example.com/XXX/mcp|Basic|Usuario:Senha
```

Os nomes normalizam `MCP_<NAME>` para lowercase com `_` como `-`. Environment definitions sobrescrevem entradas de mesmo nome em `anythingllm_mcp_servers.json` sem escrever nesse arquivo. Só o hostname aparece na UI; paths, queries e header values são redigidos.

Opcionalmente faca bootstrap do default workspace (bootstrap-only, idempotente; prompt ficticio):

```text
DEFAULT_WORKSPACE_NAME=Kepler
DEFAULT_WORKSPACE_SLUG=kepler
DEFAULT_WORKSPACE_SYSTEM_PROMPT="You are Kepler AI."
DEFAULT_WORKSPACE_CHAT_MODE=chat
DEFAULT_WORKSPACE_TEMPERATURE=1
DEFAULT_WORKSPACE_HISTORY=20
```

Para prompts grandes ou multilinha prefira Base64 ou secret file. Encoding Base64 portatil:

```bash
base64 < system-prompt.txt | tr -d '\n'
```

```text
DEFAULT_WORKSPACE_SYSTEM_PROMPT_BASE64=<base64-value>
```

```text
DEFAULT_WORKSPACE_SYSTEM_PROMPT_FILE=/run/secrets/kepler-system-prompt.txt
```

A precedencia do prompt e FILE nao vazio maior que BASE64 nao vazio maior que plain (FILE/BASE64 vazios comportam-se como nao configurados). O database e source of truth apos a criacao; restarts nunca sobrescrevem mudancas da UI/API. Mantenha prompts decodificados via env em ate aproximadamente 64 KiB; use o modo file para prompts maiores. Base64 aumenta o payload em aproximadamente 33 porcento.

Mantenha o named volume:

```text
anythingllm-storage -> /app/server/storage
```

Nenhum volume extra é exigido para drafts de agent-authored skill; eles ficam sob o existing storage volume.

Existing AnythingLLM collector volumes podem permanecer inalterados.
