# FuelLog

Aplicativo de registro de abastecimentos. Nesta etapa, a API está implementada para o primeiro fluxo vertical; o design é produzido pelo Antigravity no Paper. **Frontend ainda não iniciado**, por instrução do usuário.

## Backend disponível

Cadastro, login, refresh com rotação e prazo absoluto de seis meses, logout, identidade autenticada, catálogo de combustíveis, cadastro/listagem/detalhe de veículos e criação/listagem/detalhe de abastecimentos. Resumo e ciclos de consumo por tanques cheios também estão implementados, incluindo parciais, lacunas, combustível misto e motivos de indisponibilidade.

O servidor valida posse, decimais, total pago e ajuste, combustível permitido, data, fuso e vizinhos do hodômetro. Criações usam UUID do cliente e hash normalizado para impedir duplicação. Mutações são serializadas por veículo. Sessão revogada ou conta desativada é bloqueada na próxima chamada protegida.

Contrato: [contracts/openapi.json](contracts/openapi.json), com 14 operações. Decimais são strings com ponto; respostas de entidade incluem ETag. Edição, exclusão, exportações, recuperação de senha e gestão completa da conta continuam planejados. A API não deve ser tratada como MVP completo nem como pronta para produção.

## Requisitos

- JDK 26; Spring Boot 4.1.2 preservado.
- Maven Wrapper 3.10.0 incluído. O Maven global 3.9.14 também foi usado durante a implementação.
- PostgreSQL 18. A verificação local usa os binários instalados; não depende de Docker.
- RTK para o script de verificação, conforme preferência do projeto.

O alvo Java original era 27, incompatível com o JDK instalado. O histórico dessa decisão está na documentação local `.docs/orchestration/CONTEXT.md`, fora do versionamento.

## Executar testes

Na raiz, em PowerShell:

```powershell
.\scripts\Test-Backend.ps1
```

Se o PostgreSQL estiver em outro local:

```powershell
.\scripts\Test-Backend.ps1 -PostgresBin 'C:\caminho\PostgreSQL\18\bin'
```

O script cria um cluster e um banco exclusivos de teste em `api/target/postgres-tests-<id>`, com senha aleatória, porta local disponível e autenticação SCRAM. Executa o Wrapper com perfil `verification` e para o cluster no bloco `finally`. Não usa nem apaga bancos existentes. Logs e cluster parado permanecem como evidência; o arquivo transitório de senha é removido.

Somente testes unitários e contrato, sem iniciar banco:

```powershell
rtk proxy .\api\mvnw.cmd -f api/pom.xml -Pverification test
```

O perfil `verification` usa `api/target/verification` para impedir colisão com a compilação automática da IDE em `target/classes`. Não altera configurações da IDE. Resultados: `surefire-reports` e `failsafe-reports` dentro dessa pasta.

## Executar API local

Configure `FUELLOG_DB_PASSWORD` no ambiente com uma senha exclusiva de desenvolvimento. Com Docker ativo, o Compose oferece PostgreSQL somente no loopback e com volume persistente:

```powershell
docker compose -f compose.yaml up -d
$env:FUELLOG_DB_URL = 'jdbc:postgresql://localhost:5432/fuellog'
$env:FUELLOG_DB_USER = 'fuellog'
rtk proxy .\api\mvnw.cmd -f api/pom.xml -Pverification spring-boot:run '-Dspring-boot.run.profiles=local'
```

Também é possível apontar as três variáveis `FUELLOG_DB_URL`, `FUELLOG_DB_USER`, `FUELLOG_DB_PASSWORD` para um banco local dedicado. Flyway aplica o esquema; Hibernate apenas valida (`ddl-auto=validate`). Não aponte para bancos com dados reais sem um procedimento próprio.

`GET /actuator/health` é público e mínimo. As rotas de negócio usam `Authorization: Bearer <access_token>`, exceto POST de cadastro/login/refresh. Não envie bearer antigo ao renovar; o servidor ignora esse header nessas três rotas públicas.

Somente `local` e `test` admitem chaves RSA efêmeras. Fora desses perfis, configure `fuellog.security.private-key` (Resource PEM PKCS8), `fuellog.security.public-key` (PEM X509), issuer e audience. Nunca coloque chaves em assets/mobile/Git. Reiniciar a API local troca a chave efêmera e invalida access tokens anteriores; refresh ainda exige sessão válida no banco.

## Coordenação

A documentação local de contexto, tarefas, contratos e handoff está em `.docs/orchestration`; as evidências e orientações de verificação estão em `.docs/TESTING.md`. A pasta `.docs` é preservada localmente e permanece fora do versionamento. O contrato HTTP e o script de verificação reproduzível estão versionados nos caminhos indicados acima.

O [protótipo editável no Paper](https://app.paper.design/file/01M5R8XKXAF4G7PSCSJ1X77D9J/p-1-0) foi produzido pelo Antigravity com Gemini 4 Argon Medium. As seis telas principais foram revisadas em claro/escuro. Estados, storyboards e ajustes da biblioteca estão parcialmente bloqueados pelo limite semanal do MCP; o inventário e as pendências ficam no handoff. Nenhuma animação nativa foi implementada ou testada.

Os planos e as imagens originais foram preservados em `.docs`. As operações Git pertencem ao OpenCode com MiMo-V2.6-Flash Free, sob revisão técnica do Codex e restrição de custo zero definida em AGENTS.md.
