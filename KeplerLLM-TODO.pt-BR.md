# KeplerLLM TODO

> Tradução em português. Lista canônica em inglês (US): [KeplerLLM-TODO.md](KeplerLLM-TODO.md).

Este arquivo acompanha o trabalho planejado para a clean reimplementation do KeplerLLM. Não faz parte da functional specification em `KeplerLLM.md`.

## Planned

- [ ] Trocar referências user-visible de `AnythingLLM` para `KeplerLLM` (UI strings, emails, titles, descriptions, help texts). Manter package names, imports, code identifiers e API contracts inalterados sempre que renomear puder alterar o software behavior.
- [ ] Definir o clean reimplementation prompt a partir do `KeplerLLM.md` mais esta lista.

## Documentation rule

- Manter o `KeplerLLM.md` como canonical specification em inglês (US).
- Manter o `KeplerLLM.pt-BR.md` como Portuguese translation com technical expressions preservadas em inglês.
- Manter este arquivo (`KeplerLLM-TODO.pt-BR.md`) como tradução; o `KeplerLLM-TODO.md` é a canonical task list em inglês (US).
