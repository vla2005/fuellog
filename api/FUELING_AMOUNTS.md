# Valor pago, preço e litros

O contrato de escrita mantém os campos existentes: `paidTotal` (decimal string, até 2 casas), `unitPrice` (até 4), `liters` (até 3) e `adjustmentReason`. Todos os valores são positivos e mantêm os limites NUMERIC existentes.

- Sem desconto (`adjustmentReason` ausente/vazio), litros devem ser iguais a `HALF_UP(paidTotal / unitPrice, 3)` ou o produto `liters * unitPrice`, arredondado HALF_UP para centavos, deve ser igual ao valor pago. A segunda opção aceita o volume real do comprovante quando os centavos não determinam um único volume.
- Com desconto, a checkbox envia `adjustmentReason` não vazio, com padrão `Desconto`. O valor efetivamente pago não pode superar o produto arredondado para centavos. A declaração não comprova o desconto; informa que o volume real e o pago real diferem da tarifa anunciada.
- A API usa BigDecimal e valida os valores enviados; a justificativa não autoriza sobrepreço. O frontend mantém o volume digitado manualmente ao alterar preço/pago e exige correção se houver inconsistência. O pagamento não é recalculado a partir do volume.
- POSTs repetidos mantêm a comparação com o fingerprint original antes da validação nova. PUTs sem mudança numérica de litros/preço/pago nem mudança no motivo preservam ajustes históricos, inclusive numa correção de data. Alterações financeiras seguem a regra nova. Nenhum registro é recalculado por migração.

V6 amplia o CHECK legado para aceitar o quociente arredondado de três casas, cuja diferença em centavos pode exceder R$ 0,05 em preços altos válidos. Mantém as permissões necessárias aos registros históricos; as novas escritas são validadas pelo domínio/serviço. GPS, posse, UUID idempotente e If-Match continuam vigentes.
