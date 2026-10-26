# Abastecimentos: GPS obrigatório e mapa

## Contrato HTTP

`POST /api/v1/vehicles/{vehicleId}/fuel-entries` preserva UUID do cliente, valores decimais, data/fuso, combustível e hodômetro. Novos UUIDs exigem `latitude` e `longitude`: números JSON finitos em graus WGS84, nos intervalos inclusivos `[-90, 90]` e `[-180, 180]`, com até sete casas decimais após remover zeros finais. Zero é válido; strings numéricas não são aceitas. O servidor não arredonda coordenadas silenciosamente.

- `201`: criação; `200`: reenvio idempotente.
- `422 VALIDATION_ERROR`: GPS ausente, par incompleto, intervalo ou precisão inválidos; `fieldErrors` identifica o campo.
- `400`: tipo JSON incorreto, NaN ou infinidades.
- `409 IDEMPOTENCY_CONFLICT`: UUID já utilizado com outro comando, inclusive coordenada diferente.

Autenticação e posse continuam obrigatórias. Respostas de criação/reenvio, detalhe e histórico incluem as coordenadas como números. Registros anteriores têm ambos os campos nulos; o cliente informa localização indisponível, sem fabricar coordenadas nem consultar o GPS atual para representar um registro antigo.

Omissão ou null de `tankState` produz `UNKNOWN`; de `historyGapBefore`, false. Lacunas pendentes do servidor continuam aplicáveis. Posto e observação permanecem opcionais no contrato para compatibilidade. O novo formulário deixa de coletar tanque, lacuna, posto e observação. Os dados antigos são preservados. `adjustmentReason` continua obrigatório quando o ajuste financeiro excede a tolerância existente. Sem novos registros FULL não há fechamento de novos ciclos cheio-a-cheio; compras e totais continuam contabilizados e consumo sem ciclo válido permanece indisponível.

## Captura e reenvio

O app solicita localização automaticamente em primeiro plano, após restaurar o rascunho do usuário e veículo atuais. Não há rastreamento contínuo. Valida finitude e intervalos, normaliza uma vez com `Number(value.toFixed(7))` e preserva o par junto do UUID e restante do comando. GPS negado, desligado, indisponível ou com timeout bloqueia novo salvamento e preserva os campos digitados. Recapturar invalida imediatamente a coordenada anterior. Capturas pendentes são invalidadas quando a tela fica oculta ou o app entra em segundo plano; respostas obsoletas não substituem a captura atual.

Após resposta incerta, reenvios usam exatamente o mesmo snapshot e UUID, sem recaptura. Reenvios exatos de comandos anteriores à exigência de GPS podem omitir as coordenadas: o hash original é mantido e o registro existente é devolvido com localização nula. Isso não permite criar um UUID novo sem GPS. Adicionar coordenadas a um comando legado já salvo resulta em conflito. Clientes antigos precisam atualizar para criar registros; comandos antigos já persistidos ainda podem confirmar seus reenvios.

## Banco e integração

`V3__fuel_entry_coordinates.sql` adiciona duas colunas NUMERIC(10,7) anuláveis, com restrições de par completo e intervalos. V1 permanece intacta. V2 pertence à funcionalidade de quilometragem do veículo: integrar V2 antes de aplicar V3 em bases persistentes, sem ativar migrações fora de ordem. Não há backfill, exclusão de colunas antigas ou recálculo de hashes e consumo.

## Mapa

Web mantém o embed HTTPS do OpenStreetMap, `https://www.openstreetmap.org/export/embed.html`, em iframe; iOS mantém react-native-webview. Android usa imagens raster nativas com `expo-image`, já instalado, obtidas de `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. A projeção Mercator centraliza o marcador na coordenada e solicita apenas os tiles que intersectam a moldura, até nove para 300×300. Há zoom limitado, coordenadas textuais, atribuição visível, carregamento, erro/timeout e nova tentativa manual. Falha do mapa não invalida um GPS já capturado.

No Android, `cachePolicy="memory-disk"` reutiliza o cache persistente do Glide, com URLs estáveis, sem prefetch, limpeza global ou parâmetros para contornar cache. A identificação é `FuelLog/1.0 (+https://github.com/vla2005/fuellog)`; não há Referer simulado. O cache é LRU e não possui expiração temporal configurada pelo app; sua permanência sob pressão de armazenamento não foi medida no aparelho.

Investigação de 2026-10-26: o print do Android mostrou o bloqueio geral de tiles do provedor. O carregador anterior, `Image` do React Native 0.88, aplica `Cache-Control: no-store` no caminho Android padrão de `ReactOkHttpNetworkFetcher`, mesmo com User-Agent definido no TypeScript. A troca para `expo-image` remove esse caminho e seu cabeçalho. Uma requisição de diagnóstico no computador, com a identificação anterior legítima `FuelLog/1.0`, recebeu HTTP 200 e PNG. Isso não identifica, por si só, a causa exclusiva do 403 observado no aparelho; não foi capturado seu tráfego de rede. Não trocar identidade, host ou proxy para contornar bloqueio.

O provedor recebe as coordenadas presentes na URL. A URL é construída somente com números validados; navegação nativa fica limitada à origem/caminho do embed. Não enviar tokens, nomes ou observações. Não há chave paga ou contratação. O mapa exige rede; não há garantia de disponibilidade nem SLA. Não fazer prefetch/download offline ou ignorar cabeçalhos de cache. Respeitar identificação e Referer, cache e atribuição exigidos pelo provedor. Reavaliar a solução se volume ou garantias mudarem.

Referências consultadas em 2026-10-25: [embed OSM](https://wiki.openstreetmap.org/wiki/Export), [WebView no Expo](https://docs.expo.dev/versions/latest/sdk/webview/), [política de tiles](https://operations.osmfoundation.org/policies/tiles/), [copyright](https://www.openstreetmap.org/copyright) e [atribuição](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines).

Referências adicionais em 2026-10-26: [bloqueio de tiles](https://wiki.openstreetmap.org/wiki/Blocked_tiles), [Expo Image](https://docs.expo.dev/versions/latest/sdk/image/) e [cache do Glide](https://bumptech.github.io/glide/doc/caching.html).

## Evidências e limites

Correção de 2026-10-26: typecheck e 60 testes Node passaram. Os testes exercitam geometria dos tiles, ausência de prefetch fora da moldura, cache persistente selecionado, identidade do cliente, eventos de carga/403, retry com URLs estáveis, callbacks antigos e replay de efeitos. A exportação Android passou em `app/test-results/android-native-map-export`; o Playwright com API e OSM reais passou em Novo e Detalhe, incluindo persistência das coordenadas. O usuário confirmou no Expo Go Android: "Mapa carregou". Essa confirmação comprova o funcionamento observado no aparelho após a correção; não comprova a causa exclusiva do bloqueio anterior nem mede headers ou retenção do cache no telefone.

Backend integrado na main: PostgreSQL isolado em loopback 64560, `api/mvnw.cmd -f api/pom.xml -Pverification verify`, exit 0: 64 testes unitários e 27 de integração, sem falhas ou skips, incluindo V1, V2 e V3. Relatórios em `api/target/verification/{surefire-reports,failsafe-reports}`. Cluster parado ao terminar. A API local 8080 foi atualizada após backup do banco; health UP e versões Flyway 1, 2 e 3 conferidas. O teste HTTP real de precisão, ciclos, idempotência e isolamento também passou nessa API.

App integrado na main: typecheck, 48 testes Node e exportações web/Android passaram, incluindo handlers e hooks reais para bloqueio sem GPS, captura automática, timeout concorrente, tela oculta, segundo plano, payload normalizado, quilometragem opcional, rascunhos e reenvio idempotente. GPS controlado existe apenas no teste. A configuração web foi alterada de static para single; typecheck e exportação SPA passaram. Dez cenários Playwright passaram em rodadas direcionadas contra a API real 8080 e o Expo do usuário em 8081: jornada completa, dois cenários de teclado, dois de senha, isolamento de contas, logout com falha de armazenamento, consumo, contrato HTTP real e temas. A jornada verificou quilometragem 900 no cadastro, criação com GPS, precisão decimal, preservação do comando no reenvio e leitura das coordenadas persistidas. A compatibilidade aria-checked do seletor de tema foi corrigida e retestada. Os seletores da jornada distinguem conteúdo visível das telas preservadas pela navegação.

Limite do ambiente web: recarregamentos diretos de rotas no Metro apresentaram intermitentemente `Requiring unknown module "940"` em resolveMetadata; mudar para single não comprovou eliminar esse problema de desenvolvimento. A jornada aprovada usa os controles reais de navegação, sem recarregar o app a cada troca de tela. Os testes aprovados não comprovam GPS, permissões ou WebView no hardware Android.

Revisão visual web: Novo e Detalhe conferidos em 360/390, claro/escuro, com mapa OpenStreetMap real, marcador e atribuição; também foram exercitados legado sem coordenadas, permissão negada e erro/retry do mapa. As coordenadas e respostas da API foram simuladas somente no teste CDP; o OpenStreetMap não foi simulado nos cenários de sucesso. O teste inicial interceptava incorretamente o provedor e mostrava JSON vazio; foi corrigido e as capturas substituídas e revisadas. A persistência integrada foi posteriormente validada pela jornada Playwright com API real e geolocalização controlada apenas no navegador de teste. GPS no Android continua pendente; exportação e simulação não substituem essa verificação.
