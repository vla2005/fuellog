import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

function loadModule(relativePath) {
  const code = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', transpiled)(
    specifier => {
      if (specifier.includes('calendarHelper')) {
        return loadModule('../src/features/history/helpers/calendarHelper.ts');
      }
      if (specifier.includes('decimal')) {
        return loadModule('../src/utils/decimal.ts');
      }
      throw new Error(`Unmapped in test: ${specifier}`);
    },
    module,
    module.exports
  );
  return module.exports;
}

const validation = loadModule('../src/features/history/helpers/filterValidationHelper.ts');

test('valida escalas decimais e limites maximos para valor pago', () => {
  const valid1 = validation.validateDecimalField('100.50', validation.TOTAL_PAID_CONFIG);
  assert.ok(valid1.valid);
  assert.equal(valid1.scaledValue, 10050n);
  assert.equal(valid1.canonicalString, '100.50');

  const validMax = validation.validateDecimalField('9999999999.99', validation.TOTAL_PAID_CONFIG);
  assert.ok(validMax.valid);
  assert.equal(validMax.scaledValue, 999999999999n);

  // Escala acima de 2 casas
  assert.equal(validation.validateDecimalField('100.555', validation.TOTAL_PAID_CONFIG).valid, false);
  // Negativo
  assert.equal(validation.validateDecimalField('-10', validation.TOTAL_PAID_CONFIG).valid, false);
  // Excede limite maximo
  assert.equal(validation.validateDecimalField('10000000000.00', validation.TOTAL_PAID_CONFIG).valid, false);

  // Canonizacao de zeros a esquerda (evita ultrapassar limite de 64 chars)
  const excessiveZeros = '0'.repeat(65) + '100.50';
  const validZeros = validation.validateDecimalField(excessiveZeros, validation.TOTAL_PAID_CONFIG);
  assert.ok(validZeros.valid);
  assert.equal(validZeros.canonicalString, '100.50');
  assert.ok(validZeros.canonicalString.length <= 64);
});

test('valida escalas decimais e limites maximos para litros', () => {
  const valid1 = validation.validateDecimalField('45.123', validation.LITERS_CONFIG);
  assert.ok(valid1.valid);
  assert.equal(valid1.scaledValue, 45123n);

  const validMax = validation.validateDecimalField('9999999.999', validation.LITERS_CONFIG);
  assert.ok(validMax.valid);
  assert.equal(validMax.scaledValue, 9999999999n);

  // Escala acima de 3 casas
  assert.equal(validation.validateDecimalField('45.1234', validation.LITERS_CONFIG).valid, false);
  // Negativo
  assert.equal(validation.validateDecimalField('-1', validation.LITERS_CONFIG).valid, false);
  // Excede limite
  assert.equal(validation.validateDecimalField('10000000.000', validation.LITERS_CONFIG).valid, false);
});

test('valida escalas decimais e limites maximos para preco por litro', () => {
  const valid1 = validation.validateDecimalField('5.8999', validation.PRICE_PER_LITER_CONFIG);
  assert.ok(valid1.valid);
  assert.equal(valid1.scaledValue, 58999n);

  const validMax = validation.validateDecimalField('999999.9999', validation.PRICE_PER_LITER_CONFIG);
  assert.ok(validMax.valid);
  assert.equal(validMax.scaledValue, 9999999999n);

  // Escala acima de 4 casas
  assert.equal(validation.validateDecimalField('5.89999', validation.PRICE_PER_LITER_CONFIG).valid, false);
  // Negativo
  assert.equal(validation.validateDecimalField('-0.01', validation.PRICE_PER_LITER_CONFIG).valid, false);
  // Excede limite
  assert.equal(validation.validateDecimalField('1000000.0000', validation.PRICE_PER_LITER_CONFIG).valid, false);
});

test('valida intervalo min <= max com virgula e ponto', () => {
  const res1 = validation.validateDecimalRange('50,5', '100.00', validation.TOTAL_PAID_CONFIG);
  assert.ok(res1.valid);
  assert.equal(res1.minCanonical, '50.5');
  assert.equal(res1.maxCanonical, '100.00');

  // min > max
  const res2 = validation.validateDecimalRange('100.01', '100.00', validation.TOTAL_PAID_CONFIG);
  assert.equal(res2.valid, false);
  assert.match(res2.errorMessage, /mínimo não pode ser maior que o máximo/);

  // min == max
  const res3 = validation.validateDecimalRange('50.00', '50.00', validation.TOTAL_PAID_CONFIG);
  assert.ok(res3.valid);
});

test('valida datas civis e intervalo de datas', () => {
  // Ano bissexto valido
  assert.ok(validation.validateDateRange('2024-02-29', '2024-03-01').valid);

  // Data impossivel (2023 nao e bissexto)
  const resInvalidLeap = validation.validateDateRange('2023-02-29', '2023-03-01');
  assert.equal(resInvalidLeap.valid, false);

  // Data impossivel (abril tem 30 dias)
  const resInvalidDay = validation.validateDateRange('2024-04-01', '2024-04-31');
  assert.equal(resInvalidDay.valid, false);

  // Inversao: from > to
  const resInverted = validation.validateDateRange('2024-05-10', '2024-05-01');
  assert.equal(resInverted.valid, false);
  assert.match(resInverted.errorMessage, /não pode ser posterior/);
});
