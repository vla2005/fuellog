import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAdjustment,
  calculateReferenceTotal,
  formatConsumptionBR,
  parsePositiveDecimalInput,
} from '../src/utils/decimal.ts';

test('totais monetários exatos e arredondamento HALF_UP', () => {
  assert.equal(calculateReferenceTotal('35', '6,09'), '213.15');
  assert.equal(calculateReferenceTotal('10.125', '5.4321'), '55.00');
  assert.equal(calculateReferenceTotal('0.001', '5'), '0.01');
  assert.equal(calculateReferenceTotal('0.001', '4.9999'), '0.00');
});

test('entrada decimal aceita vírgula e rejeita escala excessiva, zero e negativos', () => {
  assert.deepEqual(parsePositiveDecimalInput('10,125', 3), {
    valid: true, normalizedDot: '10.125', scaledValue: 10125n,
  });
  for (const [raw, scale, reason] of [
    ['1,0001', 3, 'EXCESSIVE_SCALE'], ['5.43211', 4, 'EXCESSIVE_SCALE'],
    ['0', 3, 'NON_POSITIVE'], ['0,000', 3, 'NON_POSITIVE'],
    ['-1', 3, 'INVALID_FORMAT'], ['abc', 3, 'INVALID_FORMAT'], ['', 3, 'EMPTY'],
  ]) {
    const result = parsePositiveDecimalInput(raw, scale);
    assert.equal(result.valid, false, raw);
    assert.equal(result.errorReason, reason, raw);
    assert.equal(result.normalizedDot, null, raw);
  }
  assert.equal(calculateReferenceTotal('1.0001', '5'), null);
  assert.equal(calculateReferenceTotal('1', '0'), null);
});

test('justificativa apenas acima de cinco centavos nos dois sentidos', () => {
  for (const [paid, diff, requiresReason] of [
    ['10.05', 5n, false], ['9.95', -5n, false],
    ['10.06', 6n, true], ['9.94', -6n, true],
  ]) {
    const result = calculateAdjustment(paid, '10.00');
    assert.equal(result.validPaid, true);
    assert.equal(result.diffCents, diff);
    assert.equal(result.requiresReason, requiresReason);
  }
});

test('referência arredondada a zero ainda exige motivo para ajuste de seis centavos', () => {
  const reference = calculateReferenceTotal('0.001', '0.0001');
  assert.equal(reference, '0.00');
  const result = calculateAdjustment('0,06', reference);
  assert.equal(result.validPaid, true);
  assert.equal(result.diffCents, 6n);
  assert.equal(result.adjustmentDot, '0.06');
  assert.equal(result.requiresReason, true);
});

test('consumo indisponível continua nulo', () => {
  assert.equal(formatConsumptionBR(null), null);
  assert.equal(formatConsumptionBR(undefined), null);
  assert.equal(formatConsumptionBR(''), null);
  assert.equal(formatConsumptionBR('9.88'), '9,88 km/L');
});
