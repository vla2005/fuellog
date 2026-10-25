# AGENTS.md — FuelLog

## Projeto

FuelLog é um aplicativo para registrar abastecimentos e acompanhar
gastos, preços e consumo por veículo.

Stack definida:
- Backend: Java + Spring Boot.
- Banco: PostgreSQL.
- Migrações: Flyway.
- Mobile: React Native + Expo + TypeScript.
- Design: Paper Design por MCP.

Preserve versões e configurações existentes, salvo necessidade
demonstrada e registrada.

## Antes de começar

1. Leia este arquivo e eventuais AGENTS.md mais específicos.
2. Inspecione o código, as dependências e o estado do Git.
3. Leia os planos pertinentes em docs.
4. Examine as últimas imagens aprovadas antes de alterar a interface.
5. Confirme seu papel e o escopo da tarefa recebida.
6. Preserve alterações preexistentes do usuário.

Não recrie projetos, substitua configurações ou reorganize pastas
sem avaliar o que já existe.

## Divisão de responsabilidades

### Codex 6.1 Sol

Responsável por:
- Orquestração.
- Backend e contratos HTTP.
- Banco, índices, constraints e migrações.
- Autenticação e autorização.
- Regras de negócio e indicadores.
- Estratégia e implementação dos testes.
- Revisão técnica e integração.

### Antigravity — 3.8 Flash ou 4 Argon

Responsável por:
- Design no Paper via MCP.
- Frontend React Native.
- Componentes, navegação e temas.
- Animações e comportamento do mascote.
- Acessibilidade e adaptação de layout.
- Integração visual com os contratos do backend.

O papel concreto vem da tarefa atribuída pelo orquestrador.
Este arquivo não transforma todo agente em orquestrador.

Não substitua silenciosamente o Antigravity pelo Codex no frontend.

Use somente ferramentas e identificadores de modelos realmente
disponíveis. Não finja delegação ou comunicação entre agentes.

## Agente de operações Git

Responsável: OpenCode com MiMo-V2.6-Flash Free.

Esse agente cuida exclusivamente de:
- Inspecionar git status e diffs.
- Organizar alterações concluídas em commits coerentes.
- Escrever mensagens de commit.
- Fazer push das branches autorizadas pelo orquestrador.
- Criar e atualizar pull requests.
- Informar branch, commits, resultado do push e URL do PR.

### Limites de responsabilidade

- Não implementar funcionalidades nem corrigir código por iniciativa própria.
- Backend, banco e testes continuam com Codex.
- Frontend e design continuam com Antigravity.
- A revisão técnica e a decisão de integração pertencem ao orquestrador.
- Abrir PR não autoriza fazer merge.
- Não executar deploy.

### Procedimento obrigatório

1. Receber do orquestrador a branch, o escopo e os arquivos liberados.
2. Conferir branch atual, status e alterações existentes.
3. Verificar se os arquivos correspondem ao escopo recebido.
4. Conferir as verificações informadas pelo responsável.
5. Adicionar ao staging somente arquivos ou trechos autorizados.
6. Revisar o diff do staging antes de criar o commit.
7. Fazer commit, push e PR conforme a tarefa recebida.
8. Retornar hashes, resultados e URL do PR.

Não usar git add . ou git add -A indiscriminadamente.
Não incluir alterações incompletas de outros agentes.
Não incluir credenciais, tokens, arquivos .env ou dados sensíveis.
Não ignorar hooks ou verificações para concluir uma tarefa.
Não fazer force push, reset destrutivo, descarte de alterações
ou reescrita de commits publicados sem autorização específica.

Se arquivos continuarem sendo editados por outro agente,
solicitar ao orquestrador uma entrega estável antes de criar o commit.

Se houver conflito, falha de teste ou mudança fora do escopo,
informar o orquestrador. Não resolver alterando a implementação.

O orquestrador deve garantir acesso exclusivo à área de staging
durante commit, evitando comandos Git concorrentes no mesmo worktree.

### Restrição de custos

- Usar exclusivamente MiMo-V2.6-Flash Free no agente Git.
- Não selecionar modelos pagos, auxiliares pagos ou fallbacks pagos.
- Não comprar créditos, contratar assinaturas ou habilitar recarga automática.
- Se o modelo gratuito ficar indisponível, interromper a tarefa
  e informar o orquestrador, sem substituir o modelo.
- Não habilitar serviços pagos do GitHub.

## Coordenação

O orquestrador mantém em docs/orchestration:
- CONTEXT.md: contexto e decisões vigentes.
- TASKS.md: tarefas, responsáveis e dependências.
- CONTRACTS.md: decisões de integração.
- HANDOFF.md: progresso, verificações e próximos passos.

Reutilize documentos equivalentes, evitando duplicação.

Antes de trabalhar em paralelo:
- Defina responsabilidade por arquivos.
- Identifique dependências.
- Combine critérios de aceite.
- Evite dois agentes editando o mesmo arquivo.

O Paper deve ter um único agente escritor por vez.

Dúvidas entre frontend e backend passam pelo orquestrador.
Mudanças de contrato precisam ser comunicadas aos consumidores.

Se não houver comunicação automática, prepare um handoff completo
e continue tarefas independentes dentro do seu escopo.

## Arquitetura

- Backend em monólito modular, organizado por funcionalidades.
- Concentre regras de domínio em módulos com interfaces simples.
- Controllers traduzem HTTP; não concentram regras de negócio.
- Não exponha entidades JPA diretamente como contrato HTTP.
- Evite abstrações genéricas sem necessidade concreta.
- Frontend compartilha componentes, tokens e mecanismos de feedback.
- Mocks e integração real devem ser claramente distinguíveis.

## Banco e segurança

- Evolua o esquema por migrações Flyway versionadas.
- Não altere migrações já aplicadas; crie novas migrações.
- Não use ddl-auto=update como estratégia permanente.
- Use BigDecimal e NUMERIC para valores que exigem precisão.
- Nunca armazene senhas em texto puro.
- Não coloque segredos no código, logs ou bundle mobile.
- Valide autorização e posse no servidor.
- Aplique isolamento também em métricas e exportações.
- UUID não substitui autorização.
- Valide dados recebidos independentemente do frontend.
- Não execute ações destrutivas em bancos com dados reais sem
  autorização explícita e estratégia de recuperação.

## Regras de abastecimento

Siga o plano funcional em docs.

Preserve:
- Data/hora, litros, preço por litro, valor pago, hodômetro e combustível.
- Estado do tanque e continuidade do histórico.
- Total efetivamente pago, inclusive quando houver ajuste justificado.
- Validação de lançamentos retroativos contra os vizinhos.
- Prevenção de duplicação por reenvio.
- Tratamento de conflitos de edição.

Consumo usa ciclos válidos entre tanques cheios, incluindo os
abastecimentos intermediários e excluindo o volume do cheio inicial.

Não invente consumo para ciclos incompletos.
Ausência de indicador deve ter explicação, não um zero enganoso.

## Identidade e interface

A referência vigente é a última identidade aprovada:
- Mascote pixelado de boné, jaqueta azul e caderninho.
- Wordmark FuelLog pixelado.
- Azul royal, azul-marinho, branco quente e grafite.
- Textos e números em tipografia moderna e legível.

Não use logos antigas de bomba ou propostas abstratas rejeitadas.

Preserve a aparência do mascote.
Não redesenhe o personagem sem autorização.

Mantenha temas claro e escuro, safe areas, teclado, fonte ampliada
e rótulos acessíveis.

Imagens são referências visuais; corrija inconsistências de dados
ou usabilidade sem descaracterizar o design.

## Animações

Siga FuelLog_Plano_Interface_Paper_Codex.md, quando disponível,
e registre decisões finais em MOTION.md.

- Anime navegação, seleção, botões, sheets e feedback.
- Preserve a leitura e a digitação dos valores.
- Reutilize tokens de duração e curvas.
- Respeite movimento reduzido.
- Cancele efeitos na desmontagem e pause decoração em segundo plano.
- Evite loops decorativos contínuos.
- Não use atualização de estado React por quadro.
- Não celebre salvamento antes da confirmação.
- Preserve formulário e rascunho em falhas.

Desenho estático no Paper não comprova animação implementada.
Valide o movimento na aplicação executável.

## Testes e verificação

Codex coordena os testes, inclusive os de frontend, combinando
alterações de arquivos com o Antigravity.

Execute verificações apropriadas à mudança:
- Regras financeiras e ciclos de consumo.
- Integração com PostgreSQL e migrações.
- Isolamento entre usuários.
- Contratos HTTP.
- Reenvio, concorrência e falhas.
- Jornadas principais do aplicativo.
- Estados visuais e acessibilidade.

Não declare teste aprovado sem executá-lo.
Não afirme fluidez nativa apenas porque o bundle compilou.

## Entrega de cada tarefa

Informe:
- O que mudou.
- Arquivos alterados.
- Verificações executadas e resultados.
- Dependências, limitações e riscos concretos.
- Próximo passo ou handoff necessário.

Diferencie planejado, desenhado, implementado, integrado e testado.

## Autonomia e limites

Resolva escolhas rotineiras com base nos planos e no código.
Não peça confirmação para decisões já autorizadas.

Consulte o usuário quando faltar uma decisão relevante, acesso
indispensável ou autorização para ação externa ou destrutiva.

Não publique em lojas, contrate serviços, altere produção,
execute force push ou descarte trabalho sem autorização específica.