# Handoff — KeplerLLM Clean Fork (VS Code → OpenCode)

Cole este arquivo inteiro no OpenCode como contexto. Ele é a fonte única de verdade para continuar o trabalho.

## 1. Objetivo

Reimplementar de forma limpa, dentro deste repositório, o que o antigo hack de image overlay fazia (agora preservado em `legacy-overlay/`). Nada mais de overlay com string patch em Dockerfile. Fazer commits diretamente sobre o código upstream.

Fluxo de trabalho: `main` → feature branch → implementar + testes → PR contra a `main` deste fork (`fernando-reis-guimaraes/KeplerLLM`). Nunca abrir PRs contra `Mintplex-Labs/anything-llm`.

## 2. Estado atual do repositório (verificado em 2026-09-18)

- HEAD: `61483f56` na `main`, clean (`git status` vazio), sincronizada com `origin/main`.
- Histórico: `31c7a001 Merge upstream AnythingLLM v1.16.1 as fork base` unifica o histórico local com `v1.16.1` (`35c58d89`) usando `--allow-unrelated-histories`.
- Remotes:
  - `origin` = `https://github.com/fernando-reis-guimaraes/KeplerLLM.git`
  - `upstream` = `https://github.com/Mintplex-Labs/anything-llm.git` (fetch concluído, tags presentes, `upstream/master` em `da668551`)

- A raiz contém a árvore completa do AnythingLLM `v1.16.1` (`server/`, `frontend/`, `collector/`, `docker/` etc.) mais:
  - `legacy-overlay/` = implementação antiga (somente referência, não evoluir)
  - `QunataLLM.md`, `QunataLLM.pt-BR.md` = especificação funcional EN (canônica) + tradução PT-BR
  - `KeplerLLM-TODO.md`, `QunataLLM-TODO.pt-BR.md` = lista de tarefas EN + PT-BR
  - `README.md` na raiz = README upstream (não editar para mudanças do fork)

- Testes: `jest.config.cjs` na raiz (ignora `open-computer/`), suites em `server/__tests__/`, `collector/__tests__/`. Scripts: `yarn test`, `yarn lint`, `yarn dev:server|collector|frontend` (consulte o `package.json` da raiz).

## 3. O que `legacy-overlay/` fazia (referência, não copiar a mecânica)

- `Dockerfile`: build em dois stages. O stage 1 clonava `anything-llm@v1.16.1`, executava string replaces via `apply-*.mjs`, `node --check`, `yarn install + build`. O stage 2 copiava `frontend/dist` sobre `/app/server/public` junto com 3 arquivos de servidor modificados e substituía o `ENTRYPOINT` por `keplerllm-entrypoint.sh`.
- `keplerllm-entrypoint.sh`: criava symlink de `/app/server/.env` → `${STORAGE_DIR}/.env` (seed a partir do default da imagem no primeiro boot, falha se não houver permissão de escrita), gerava `/app/server/public/keplerllm-config.js` com `window.__KEPLERLLM_CONFIG__` a partir de `KEPLERLLM_MODEL_DISPLAY_NAME` (default `Kepler AI`) e, em seguida, executava o entrypoint upstream.
- `apply-keplerllm-branding.mjs`: override do label no model picker, injeção do config script em `MetaGenerator.js`, ordenação alfabética dos modelos OpenAI dentro de cada grupo de organização.
- `apply-keplerllm-agent-skill-authoring.mjs`: discovery em dois roots no `imported.js` (`plugins/agent-skills` + `anythingllm-fs/agent-skills`), drafts forçados para `active:false` + `keplerllmPendingReview`, promotion somente por admin toggle (`rename` + guards: correspondência de `hubId`, presença de `handler.js`, ausência de collision), exclusão do scheduler, admin vence em caso de collision, delete nos dois roots, `SkillList` exibe `Pending review`.
- Descartar a mecânica (clone dentro do Docker, replaces por exact-anchor, gerenciamento de `chown`/mode). Manter somente o comportamento observável definido em `QunataLLM.md`.

## 4. O que implementar (a partir de `QunataLLM.md`, 4 requisitos)

1. Configuração persistente da UI: volume único `/app/server/storage`, configuração em `${STORAGE_DIR}/.env` visível como `/app/server/.env`, seed apenas uma vez a partir do default da imagem, alterações feitas pela UI persistem, fail-fast se não houver permissão de escrita.
2. Label do modelo do produto: o picker exibe o label (default `Kepler AI`, override por `KEPLERLLM_MODEL_DISPLAY_NAME`), somente para exibição, override vazio faz fallback, escopo de visibilidade permanece igual ao upstream.
3. Ordenação alfabética OpenAI: manter o mesmo agrupamento por organização, ordenar alfabeticamente por nome dentro de cada grupo, IDs/seleção permanecem inalterados.
4. Staging de skills criadas por agents: drafts em `anythingllm-fs/agent-skills/<hubId>`, `Pending review`, nunca executáveis/carregáveis/agendáveis, promotion somente por admin toggle com os guards acima, isolamento de filesystem após promotion, imports do Community Hub permanecem administrativos.

   Além disso, item de `KeplerLLM-TODO.md`: substituir `AnythingLLM` → `KeplerLLM` no conteúdo visível ao usuário (strings da UI, emails, titles, descriptions, help). NÃO renomear package names, imports, identifiers ou API contracts.

## 5. Como trabalhar no OpenCode

1. `git checkout main && git pull --ff-only && git checkout -b keplerllm/<short-topic>`
2. Implementar diretamente em `server/`, `frontend/` (sem novos scripts de overlay, sem string patching em Dockerfile).
3. Adicionar/estender testes Jest: persistence seam, label fallback, OpenAI sort, lifecycle dos drafts (inactive forçado, exclusão do scheduler, promotion guards, collision precedence, delete nos dois roots).
4. `yarn test` + `yarn lint` relevante devem passar.
5. Atualizar `QunataLLM.md` (+ mirror PT-BR, mantendo termos técnicos em inglês) na mesma branch sempre que o comportamento mudar.
6. Fazer push da branch, abrir PR para `main` (deste repositório) e fazer merge internamente. Nunca usar upstream como target.

## 6. Cleanups conhecidos (fazer primeiro)

- Os filenames contêm um typo: `QunataLLM.md`, `QunataLLM.pt-BR.md`, `QunataLLM-TODO.pt-BR.md` (falta um `a`). Padronizar para `KeplerLLM.md`, `KeplerLLM.pt-BR.md`, `KeplerLLM-TODO.md`, `KeplerLLM-TODO.pt-BR.md` usando `mv` (eles estão untracked ou foram adicionados recentemente; não é necessário usar `git mv` se estiverem untracked) e corrigir os cross-links dentro dos quatro arquivos (eles ainda apontam para `KEPLERLLM.pt-BR.md`, `TODO.pt-BR.md`, `README.md` — todos stale).
- Não existe `AGENTS.md` na raiz (somente `legacy-overlay/AGENTS.md`). Criar um arquivo curto na raiz apontando a documentação das mudanças do fork para `KeplerLLM.md` e reiterando a regra de documentação de `KeplerLLM-TODO.md`.
- Decidir o destino de `legacy-overlay/.envrc` + `compose.yaml` (fluxo antigo de publicação da imagem `cr.umapps.net/umapps/keplerllm`) — manter como archive, não conectar à raiz até que o novo fluxo Docker seja definido.
- O `README.md` upstream permanece intocado; a especificação do fork fica somente em `KeplerLLM.md`.

## 7. Primeira branch sugerida

`keplerllm/filename-and-links-cleanup`: corrigir filenames + links, adicionar `AGENTS.md` na raiz, sem alteração de comportamento.

Depois, criar uma branch por requisito (1→4), mais uma para o rebrand visível ao usuário. Todas com testes.

## 8. Verificar antes do PR

- `git status --short`, `git log --oneline --graph -5`
- `yarn test` green, lint clean nos packages modificados
- Especificação + PT-BR atualizados, links resolvendo corretamente, nenhuma referência à mecânica de `legacy-overlay` no corpo da especificação
