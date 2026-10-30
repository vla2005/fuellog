import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadModule(relativePath, extraDeps = {}) {
  const path = new URL(relativePath, import.meta.url);
  const source = readFileSync(path, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (specifier) => {
    if (extraDeps[specifier]) return extraDeps[specifier];
    if (specifier === '../../utils/decimal' || specifier === '@/utils/decimal') {
      return loadModule('../src/utils/decimal.ts');
    }
    if (specifier === '../../utils/numericMask' || specifier === '@/utils/numericMask') {
      return loadModule('../src/utils/numericMask.ts');
    }
    throw new Error(`Unmapped in test loader: ${specifier}`);
  };
  new Function('require', 'module', 'exports', output)(require, module, module.exports);
  return module.exports;
}

const {
  calculateLitersFromPaidAndPrice,
  calculateReferenceTotalCents,
  isConsistentWithoutDiscount,
  validateDiscountAmounts,
} = loadModule('../src/features/fueling/fuelingCalculations.ts');

test('calculateLitersFromPaidAndPrice: caso do print objetivo R$ 153,43 a R$ 4,58 resulta em 33,500 L', () => {
  const result = calculateLitersFromPaidAndPrice('153,43', '4,58');
  assert.ok(result);
  assert.equal(result.formattedDisplay, '33,500');
  assert.equal(result.normalizedDot, '33.500');
  assert.equal(result.scaledLiters, 33500n);
});

test('calculateLitersFromPaidAndPrice: arredondamento HALF_UP com dízima periódica', () => {
  // 100 / 6 = 16.66666... -> 16.667
  const r1 = calculateLitersFromPaidAndPrice('100,00', '6,00');
  assert.ok(r1);
  assert.equal(r1.formattedDisplay, '16,667');
  assert.equal(r1.normalizedDot, '16.667');

  // Preço com 4 casas: 50 / 5.4321 = 9.20454336... -> 9.205
  const r2 = calculateLitersFromPaidAndPrice('50,00', '5,4321');
  assert.ok(r2);
  assert.equal(r2.formattedDisplay, '9,205');
  assert.equal(r2.normalizedDot, '9.205');
});

test('calculateLitersFromPaidAndPrice: rejeita entradas inválidas, zero e vazias', () => {
  assert.equal(calculateLitersFromPaidAndPrice('', '4,58'), null);
  assert.equal(calculateLitersFromPaidAndPrice('100,00', ''), null);
  assert.equal(calculateLitersFromPaidAndPrice('0,00', '4,58'), null);
  assert.equal(calculateLitersFromPaidAndPrice('100,00', '0,00'), null);
  assert.equal(calculateLitersFromPaidAndPrice('-50,00', '4,58'), null);
});

test('calculateReferenceTotalCents: cálculo de referência com escala 3 para litros e até 4 para preço', () => {
  // 33.500 * 4.58 = 153.43000 -> 153.43
  const ref1 = calculateReferenceTotalCents('33,500', '4,58');
  assert.ok(ref1);
  assert.equal(ref1.cents, 15343n);
  assert.equal(ref1.normalizedDot, '153.43');

  // 16.667 * 6.00 = 100.002 -> 100.00
  const ref2 = calculateReferenceTotalCents('16,667', '6,00');
  assert.ok(ref2);
  assert.equal(ref2.cents, 10000n);
  assert.equal(ref2.normalizedDot, '100.00');

  // 9.205 * 5.4321 = 50.0024805 -> 50.00
  const ref3 = calculateReferenceTotalCents('9,205', '5,4321');
  assert.ok(ref3);
  assert.equal(ref3.cents, 5000n);
  assert.equal(ref3.normalizedDot, '50.00');
});

test('isConsistentWithoutDiscount: aceita quociente HALF_UP3 OU produto em centavos', () => {
  // Caso 1: quociente exato
  assert.equal(isConsistentWithoutDiscount('33,500', '4,58', '153,43'), true);
  assert.equal(isConsistentWithoutDiscount('16,667', '6,00', '100,00'), true);
  assert.equal(isConsistentWithoutDiscount('9,205', '5,4321', '50,00'), true);

  // Inconsistente (diferença arbitrária sem desconto)
  assert.equal(isConsistentWithoutDiscount('30,000', '4,58', '153,43'), false);
  assert.equal(isConsistentWithoutDiscount('35,000', '4,58', '153,43'), false);
  assert.equal(isConsistentWithoutDiscount('33,510', '4,58', '153,43'), false);
  assert.equal(isConsistentWithoutDiscount('33,502', '4,58', '153,43'), false);
  // 33,501 é consistente porque o produto arredondado em centavos dá exatamente 153,43
  assert.equal(isConsistentWithoutDiscount('33,501', '4,58', '153,43'), true);
});

test('validateDiscountAmounts: permite valor pago menor ou igual à referência e bloqueia sobrepreço', () => {
  // Referência: 30.000 * 4.58 = 137.40
  // Desconto concedido: pagou 130.00 -> válido
  const validDiscount = validateDiscountAmounts('30,000', '4,58', '130,00');
  assert.equal(validDiscount.valid, true);
  assert.equal(validDiscount.referenceTotalDot, '137.40');

  // Sem desconto: pagou 137.40 -> válido
  const exact = validateDiscountAmounts('30,000', '4,58', '137,40');
  assert.equal(exact.valid, true);

  // Sobrepreço: pagou 140.00 quando referência era 137.40 -> BLOQUEADO!
  const overpriced = validateDiscountAmounts('30,000', '4,58', '140,00');
  assert.equal(overpriced.valid, false);
  assert.equal(overpriced.errorReason, 'OVERPRICED');
  assert.equal(overpriced.referenceTotalDot, '137.40');
});
