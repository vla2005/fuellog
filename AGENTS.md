# AGENTS.md — FuelLog

Java/Spring Boot, PostgreSQL/Flyway, React Native/Expo/TypeScript.
Preserve versões, arquitetura e identidade aprovadas. Consulte os planos em `docs/` sob demanda.

## Execução enxuta

Esta política vale para novas tarefas e substitui exigências antigas de agentes, worktrees e documentação sistemáticos. Economize tokens e tempo sem reduzir correção, segurança ou verificações obrigatórias.

- Leia instruções aplicáveis, estado do Git e apenas arquivos/trechos relevantes. Faça buscas direcionadas; não releia projeto, planos, imagens ou histórico completos por rotina.
- Use objetivo e critérios de aceite breves; dispense planejamento extenso em tarefas pequenas.
- Padrão: orquestrador + um implementador. O orquestrador coordena e revisa. Sem agentes exclusivos de QA, documentação, status ou handoff de rotina.
- Paralelize apenas trabalho independente com ganho claro, normalmente até dois implementadores. Defina responsáveis por arquivos. Sem escrita concorrente ou subdelegação em cascata.
- Reutilize a sessão da tarefa; substitua-a com resumo mínimo se acumular contexto irrelevante. Delegue objetivo, critérios, referências, restrições e validação; não todo o histórico.
- Evite consultas de status repetitivas. Diante de tentativas sem avanço, diagnostique o bloqueio; não abra mais agentes para contorná-lo sem entender a causa.
- Resolva decisões rotineiras autonomamente. Pergunte apenas por decisão material, acesso ou autorização indispensável ainda ausente.
- Cumpra o escopo e finalize ao atender critérios e verificações. Deixe melhorias opcionais para depois; sem refatorações, dependências, polimento ou prazos artificiais.

## Responsáveis

- **Codex 6.1 Sol:** orquestração, backend, banco, contratos, segurança, regras de negócio, testes, revisão e integração.
- **Antigravity / Gemini 3.8 Flash, esforço HIGH:** código frontend, animações, integrações, análise e correção de bugs, além de design, inclusive Paper/FigCraft. Esta é a seleção vigente até nova orientação do usuário; Gemini 4 Argon está sem cota e não deve ser utilizado.
- **Antigravity / Gemini 3.8 Flash:** conversas, planejamento e documentação. Para atividades de frontend, confirme o modelo e o esforço HIGH nas ferramentas reais antes de implementar; se indisponíveis, informe a limitação sem substituir silenciosamente.
- **OpenCode / MiMo V2.6 Flash Free:** somente Git.

Não abra uma sessão por responsabilidade. O orquestrador pode executar verificações e revisar o diff sem outro Codex; coordene arquivos de testes compartilhados com Antigravity.

Agrupe etapas do Antigravity para evitar trocas desnecessárias; status fica com o orquestrador. Selecione modelos nas ferramentas reais. Não alegue troca não confirmada nem substitua silenciosamente modelo indisponível.

## Worktrees e coordenação

- Trabalhe e entregue por padrão na `main`, em `C:/Users/vikto/Desktop/FuelLog`, para que o usuário acompanhe as funcionalidades juntas. Faça commits na `main` após as verificações pertinentes. Não crie novos commits nos worktrees de funcionalidades existentes; use-os somente como fonte da integração e preserve suas alterações. Novo isolamento em worktree exige pedido específico do usuário.
- Confira base, branch e alterações antes de criar: trabalho não commitado não acompanha automaticamente o novo checkout.
- Preserve alterações preexistentes; não descarte trabalho nem remova worktrees com pendências.
- Um responsável pelo staging no worktree correto; commits após estabilizar arquivos.
- Paper/FigCraft: um escritor por documento; worktrees não isolam o design.
- Reutilize registros existentes. Não exija CONTEXT, TASKS, CONTRACTS e HANDOFF por tarefa. Registre apenas decisões duráveis, contratos alterados e pendências necessárias.
- O orquestrador transmite dúvidas/respostas com contexto mínimo. Não mantenha agentes ociosos.

## Implementação

- Monólito modular por funcionalidade; domínio contém regras, controllers traduzem HTTP, DTOs definem contratos. Sem entidades JPA expostas ou abstrações desnecessárias.
- Novas migrações Flyway; não edite as aplicadas. Sem `ddl-auto=update` permanente. BigDecimal/NUMERIC para precisão.
- Valide entradas, autorização e posse no servidor, inclusive métricas/exportações. UUID não autoriza acesso. Senhas com hash; segredos fora de código, logs e bundle.
- Preserve autenticação do plano: access curto, refresh duradouro com rotação/revogação, validação central em toda rota protegida e usuário do contexto autenticado. Refresh no app coordenado, sem loops.
- Preserve campos e regras de abastecimento, total efetivamente pago, validação retroativa entre vizinhos, reenvios e conflitos. Consumo usa ciclos válidos entre cheios, incluindo intermediários e excluindo o volume inicial; não invente indicadores incompletos.
- Distinga mocks de integração real. Sem destruição de dados reais ou mudanças em produção sem autorização e recuperação adequada.
- Preserve mascote de boné, jaqueta azul e caderninho, wordmark pixelado e paleta aprovada. Sem redesenho ou propostas rejeitadas. Consulte imagens e Paper/FigCraft apenas quando pertinentes.
- Reutilize componentes/tokens; mantenha temas claro/escuro, legibilidade, safe areas, teclado, fonte ampliada e acessibilidade.
- Animações: movimento reduzido, limpeza na desmontagem, pausa em segundo plano; evite loops contínuos e estado React por quadro. Preserve formulários em falhas e celebre somente salvamento confirmado.
- Atualize documentação, inclusive movimento, apenas quando seu conteúdo mudar.

## Verificação e entrega

- Revise diff e caminhos afetados; amplie por risco ou evidência. Revisão independente exige motivo concreto.
- Execute verificações pertinentes e obrigatórias. Teste cálculos, auth, isolamento, migrações, concorrência ou jornadas quando afetados. Evite testes que apenas copiem a implementação.
- Reutilize resultados válidos; repita após alteração relevante, falha ou dúvida. Consolide observações antes de pedir correções.
- Não declare testes ou validações não executados. Compilação/desenho não comprova animação nativa.
- Entrega curta: mudança, validação, pendência relevante e commits/PR, se houver. Diferencie implementado de integrado/testado; dispense relatórios extensos.

## Git e custos

Concluída uma unidade coerente, encaminhe ao agente Git o diretório principal, branch `main`, escopo, arquivos liberados e validação. Agrupe operações; não abra agente por commit. A integração local das funcionalidades atuais na `main` está autorizada pelo usuário; preserve o trabalho existente e valide a combinação antes do commit. Push/PR conforme pedido ou autorização vigente; PR não autoriza merge.

- Confira branch/status, diff e staging. Adicione arquivos/trechos explícitos; sem `git add .` ou `git add -A` indiscriminados.
- Commits pequenos: `feat(api): ...`, `feat(app): ...`, `fix(api): ...`, `docs: ...`, `test(api): ...`, `chore: ...`. Sem escopo vazio.
- Exclua segredos, .env e trabalho incompleto/alheio. Preserve hooks. Git não altera implementação; conflitos/falhas voltam ao responsável.
- Retorne hashes, resultados e URL do PR quando criado.
- Sem merge, deploy, force push, reset destrutivo, descarte ou reescrita de commits publicados sem autorização específica.
- Git usa MiMo V2.6 Flash Free como padrão. Enquanto estiver sem cota, o usuário autoriza outro modelo comprovadamente gratuito do OpenCode, com modelo principal e auxiliar gratuitos confirmados no ambiente. Sem fallback/auxiliar pago, créditos, assinatura, recarga automática ou serviço pago do GitHub. Se não houver modelo gratuito disponível, pare essa etapa e informe.

Configure modelos e cobrança no ambiente: instruções textuais não garantem gratuidade.

## Exceção temporária de Git autorizada pelo usuário

Para as atividades atuais, use GPT-6 Luna com esforço low nas operações Git, conforme autorização explícita do usuário. Confirme modelo e esforço nas ferramentas reais. Essa exceção substitui temporariamente apenas o roteamento e a exigência de modelo gratuito do agente Git; não autoriza compra, recarga, serviços pagos, push/PR/merge além do escopo aprovado, nem alterações de implementação pelo agente Git.
