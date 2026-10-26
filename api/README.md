# FuelLog API em Docker

Java 26/Spring Boot 4.1.2 e PostgreSQL 18. O build usa Maven Wrapper e cache BuildKit; o runtime contém somente JRE Alpine e camadas da aplicação, executadas por usuário sem privilégios. Não inclui Maven, fontes, testes ou `.env`.

## Execução local

Requer Docker com Compose. O arquivo local `.env` é privado e ignorado pelo Git. Na pasta `api`, use `.env.example` como modelo para preencher manualmente `.env`, preservando configurações que já existirem. Preencha uma senha aleatória forte e as duas chaves antes de iniciar: o Compose rejeita os valores obrigatórios ausentes. Ele lê `.env` automaticamente; nenhum arquivo de ambiente entra na imagem.

O projeto Compose padrão é `fuellog`, com imagem `fuellog-api:local` e containers `fuellog-api-1` e `fuellog-db-1`. `-p` ou `COMPOSE_PROJECT_NAME` substituem esse nome e o prefixo da imagem; o nome usa minúsculas, conforme exigido pelo Compose.

Gere um par RSA de 3072 bits com OpenSSL, em uma pasta temporária privada:

```sh
umask 077
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
openssl rand -hex 32
openssl base64 -A -in private.pem
openssl base64 -A -in public.pem
```

Use a senha e os valores Base64 somente no arquivo privado ou no gerenciador de segredos. Não publique a saída em logs ou chats. A chave privada deve ser PEM PKCS8 (`BEGIN PRIVATE KEY`); a pública, X509 (`BEGIN PUBLIC KEY`). Guarde backup seguro do par e remova os PEM temporários após configurar. O entrypoint decodifica as chaves em `/tmp`, com diretório 0700 e arquivos 0600, e inicia Java com `exec`. O perfil `prod` exige um par válido; não existe fallback para chave efêmera.

```sh
docker compose -f docker-compose.yml -f docker-compose.local.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --wait
curl http://127.0.0.1:8080/actuator/health
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

O override publica apenas a API em `127.0.0.1:8080`. Se a porta estiver ocupada, ajuste `API_PORT` no `.env` antes de iniciar. `API_BIND_ADDRESS` permite outro endereço; `0.0.0.0` expõe a API na rede. O PostgreSQL nunca publica porta no host. A API espera o banco saudável e executa Flyway ao iniciar. O healthcheck consulta `/actuator/health` e o encerramento concede 30 segundos à API.

`down` preserva os dados. **Não use `down -v` em dados que precisa manter.** O volume `postgres_data` pertence ao projeto Compose e monta `/var/lib/postgresql`, conforme PostgreSQL 18. Mantenha o nome do projeto estável; outro nome cria outro volume. Dados do PostgreSQL local não são importados automaticamente. Na separação local do projeto legado `api`, os dados foram copiados com o banco parado para `fuellog_postgres_data`; `api_postgres_data` foi preservado como backup anterior à separação e não acompanha novas gravações.

## Variáveis

| Variável | Uso |
| --- | --- |
| `POSTGRES_PASSWORD` | Obrigatória; senha do banco e conexão da API. |
| `POSTGRES_DB`, `POSTGRES_USER` | Padrão `fuellog`; configuração inicial do banco e conexão da API. |
| `FUELLOG_SECURITY_PRIVATE_KEY_BASE64` | Obrigatória; Base64 do PEM privado PKCS8. |
| `FUELLOG_SECURITY_PUBLIC_KEY_BASE64` | Obrigatória; Base64 do PEM público X509 correspondente. |
| `FUELLOG_SECURITY_ISSUER` | Emissor JWT; padrão `fuellog-api`. |
| `FUELLOG_SECURITY_AUDIENCE` | Público JWT; padrão `fuellog-mobile`. |
| `FUELLOG_CORS_ALLOWED_ORIGINS` | Origens web separadas por vírgula; configure domínios reais no servidor. |
| `API_PORT`, `API_BIND_ADDRESS` | Somente override local; padrões `8080` e `127.0.0.1`. |

## Coolify

Crie uma aplicação do repositório com build pack **Docker Compose**, branch desejada, **Base Directory `/api`** e **Docker Compose Location `/docker-compose.yml`**. O contexto de build é `.` dentro de `api`. Use somente o Compose base, sem override local: não há portas publicadas no host. O nome de projeto definido pelo Coolify (por exemplo, UUID via `-p`) prevalece sobre `fuellog` e também prefixa a imagem, isolando recursos. Configure domínio HTTPS para o serviço `api`, porta interna `8080`, pelo proxy do Coolify.

Preencha as variáveis obrigatórias e os ajustes de CORS/issuer/audience no painel **Environment Variables** do recurso, como valores de runtime, não build arguments. O Compose referencia as variáveis por interpolação; não requer `env_file` nem arquivo `.env` versionado. Marque senha e chaves como segredos e não as mostre em logs. Preserve o volume do serviço `db` e o nome do recurso. Esta configuração não realiza deploy nem altera uma VPS.

## Backup e rotação

Faça backup verificado do banco e das chaves antes de migração ou rotação. `POSTGRES_PASSWORD`, `POSTGRES_USER` e `POSTGRES_DB` inicializam **somente volumes vazios**. Alterar a senha no painel ou `.env` não modifica a senha de um banco existente: execute `ALTER ROLE` de forma controlada, sincronize a credencial da API e recrie os serviços envolvidos. Não apague o volume para trocar credenciais.

Mantenha o mesmo par RSA entre recriações para preservar tokens ainda válidos. Para rotação, configure as duas novas chaves correspondentes e recrie a API; tokens assinados pela chave anterior deixarão de validar. Alterações de issuer/audience também afetam tokens existentes. Não há rotação automática nem suporte simultâneo a múltiplas chaves nesta configuração.

Referências: [Spring Boot Dockerfiles](https://docs.spring.io/spring-boot/reference/packaging/container-images/dockerfiles.html), [Temurin oficial](https://hub.docker.com/_/eclipse-temurin), [PostgreSQL oficial](https://hub.docker.com/_/postgres) e [Coolify Compose](https://coolify.io/docs/applications/builds/docker-compose).
