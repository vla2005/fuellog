import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDigitsToDisplay,
  parseArbitraryInputToDigits,
  applyNumericMaskChange,
} from '../src/utils/numericMask.ts';

test('formatação de dígitos para exibição por escala fixa', () => {
  // Litros (escala 3)
  assert.equal(formatDigitsToDisplay('35125', 3), '35,125');
  assert.equal(formatDigitsToDisplay('5', 3), '0,005');
  assert.equal(formatDigitsToDisplay('50', 3), '0,050');
  assert.equal(formatDigitsToDisplay('500', 3), '0,500');
  assert.equal(formatDigitsToDisplay('0', 3), '0,000');
  assert.equal(formatDigitsToDisplay('', 3), '');

  // Preço por litro (escala 4)
  assert.equal(formatDigitsToDisplay('54321', 4), '5,4321');
  assert.equal(formatDigitsToDisplay('1', 4), '0,0001');
  assert.equal(formatDigitsToDisplay('60900', 4), '6,0900');
  assert.equal(formatDigitsToDisplay('0', 4), '0,0000');
  assert.equal(formatDigitsToDisplay('', 4), '');

  // Valor pago (escala 2)
  assert.equal(formatDigitsToDisplay('10000', 2), '100,00');
  assert.equal(formatDigitsToDisplay('5', 2), '0,05');
  assert.equal(formatDigitsToDisplay('50', 2), '0,50');
  assert.equal(formatDigitsToDisplay('0', 2), '0,00');
  assert.equal(formatDigitsToDisplay('', 2), '');

  // Hodômetro (escala 0, inteiro sem decimais)
  assert.equal(formatDigitsToDisplay('120542', 0), '120542');
  assert.equal(formatDigitsToDisplay('0', 0), '0');
  assert.equal(formatDigitsToDisplay('', 0), '');
});

test('digitação sequencial da direita para a esquerda (máscara tipo moeda)', () => {
  // Litros: digita 3, 5, 1, 2, 5
  let digits = '';
  let formatted = '';

  for (const [key, expectedDigits, expectedFormatted] of [
    ['3', '3', '0,003'],
    ['5', '35', '0,035'],
    ['1', '351', '0,351'],
    ['2', '3512', '3,512'],
    ['5', '35125', '35,125'],
  ]) {
    const nextText = formatted + key;
    const res = applyNumericMaskChange(digits, formatted, nextText, 3);
    assert.equal(res.digits, expectedDigits, `Digits mismatch after typing ${key}`);
    assert.equal(res.formatted, expectedFormatted, `Display mismatch after typing ${key}`);
    digits = res.digits;
    formatted = res.formatted;
  }

  // Preço: digita 5, 4, 3, 2, 1
  digits = '';
  formatted = '';
  for (const [key, expectedDigits, expectedFormatted] of [
    ['5', '5', '0,0005'],
    ['4', '54', '0,0054'],
    ['3', '543', '0,0543'],
    ['2', '5432', '0,5432'],
    ['1', '54321', '5,4321'],
  ]) {
    const nextText = formatted + key;
    const res = applyNumericMaskChange(digits, formatted, nextText, 4);
    assert.equal(res.digits, expectedDigits);
    assert.equal(res.formatted, expectedFormatted);
    digits = res.digits;
    formatted = res.formatted;
  }

  // Hodômetro: digita 1, 2, 0, 5, 4, 2
  digits = '';
  formatted = '';
  for (const [key, expectedDigits, expectedFormatted] of [
    ['1', '1', '1'],
    ['2', '12', '12'],
    ['0', '120', '120'],
    ['5', '1205', '1205'],
    ['4', '12054', '12054'],
    ['2', '120542', '120542'],
  ]) {
    const nextText = formatted + key;
    const res = applyNumericMaskChange(digits, formatted, nextText, 0);
    assert.equal(res.digits, expectedDigits);
    assert.equal(res.formatted, expectedFormatted);
    digits = res.digits;
    formatted = res.formatted;
  }
});

test('apagar sequencial (backspace no fim) e limpar', () => {
  let digits = '35125';
  let formatted = '35,125';

  for (const [expectedDigits, expectedFormatted] of [
    ['3512', '3,512'],
    ['351', '0,351'],
    ['35', '0,035'],
    ['3', '0,003'],
    ['', ''],
  ]) {
    const nextText = formatted.slice(0, -1);
    const res = applyNumericMaskChange(digits, formatted, nextText, 3);
    assert.equal(res.digits, expectedDigits);
    assert.equal(res.formatted, expectedFormatted);
    digits = res.digits;
    formatted = res.formatted;
  }

  // Limpeza direta (nextText vazio)
  const cleared = applyNumericMaskChange('35125', '35,125', '', 3);
  assert.equal(cleared.digits, '');
  assert.equal(cleared.formatted, '');
});

test('edição no meio (remoção e substituição parcial preservam o texto editado)', () => {
  // Apagar o '2' no meio de 35,125 resulta em 35,15 -> 35,150 (não pode apagar o 5 final e virar 3,512)
  const deleteMiddle = applyNumericMaskChange('35125', '35,125', '35,15', 3);
  assert.equal(deleteMiddle.digits, '35150');
  assert.equal(deleteMiddle.formatted, '35,150');

  // Substituir o '2' no meio de 35,125 por '9' resulta em 35,195
  const replaceMiddle = applyNumericMaskChange('35125', '35,125', '35,195', 3);
  assert.equal(replaceMiddle.digits, '35195');
  assert.equal(replaceMiddle.formatted, '35,195');

  // Alterar parte inteira: de 35,125 para 42,125
  const replaceInt = applyNumericMaskChange('35125', '35,125', '42,125', 3);
  assert.equal(replaceInt.digits, '42125');
  assert.equal(replaceInt.formatted, '42,125');
});

test('rejeição estrita de negativos, excesso de escala e limites (sem corte/truncamento silencioso)', () => {
  // Negativo rejeitado (retorna null)
  assert.equal(parseArbitraryInputToDigits('-12,50', 2), null);
  assert.equal(parseArbitraryInputToDigits('-100', 0), null);
  assert.equal(parseArbitraryInputToDigits(' -35.125 ', 3), null);

  // Excesso de escala rejeitado (retorna null, nunca truncar 35,1259 para 35,125)
  assert.equal(parseArbitraryInputToDigits('35,1259', 3), null);
  assert.equal(parseArbitraryInputToDigits('5,43211', 4), null);
  assert.equal(parseArbitraryInputToDigits('100,555', 2), null);

  // Colagem acima de maxDigits (14) rejeitada (retorna null, nunca fatiar magnitude)
  assert.equal(parseArbitraryInputToDigits('123456789012345', 3), null);
  assert.equal(parseArbitraryInputToDigits('123456789012345', 0), null);

  // applyNumericMaskChange rejeita e mantém o valor anterior intacto
  const rejectNeg = applyNumericMaskChange('35125', '35,125', '-12,50', 2);
  assert.equal(rejectNeg.digits, '35125');
  assert.equal(rejectNeg.formatted, '35,125');

  const rejectScale = applyNumericMaskChange('10000', '10,000', '35,1259', 3);
  assert.equal(rejectScale.digits, '10000');
  assert.equal(rejectScale.formatted, '10,000');

  const rejectScaleEmpty = applyNumericMaskChange('', '', '35,1259', 3);
  assert.equal(rejectScaleEmpty.digits, '');
  assert.equal(rejectScaleEmpty.formatted, '');

  const rejectBulk = applyNumericMaskChange('35125', '35,125', '123456789012345', 3);
  assert.equal(rejectBulk.digits, '35125');
  assert.equal(rejectBulk.formatted, '35,125');
});

test('substituir tudo por 1 único dígito (escala 0 e escala fixa > 0)', () => {
  // Escala 0: substituir '5' por '9' resulta em '9'
  const replaceZeroScale = applyNumericMaskChange('5', '5', '9', 0);
  assert.equal(replaceZeroScale.digits, '9');
  assert.equal(replaceZeroScale.formatted, '9');

  // Escala 3: selecionar tudo em '35,125' e digitar '9' resulta em '0,009'
  const replaceScale3 = applyNumericMaskChange('35125', '35,125', '9', 3);
  assert.equal(replaceScale3.digits, '9');
  assert.equal(replaceScale3.formatted, '0,009');

  // Escala 2: selecionar tudo em '100,00' e digitar '5' resulta em '0,05'
  const replaceScale2 = applyNumericMaskChange('10000', '100,00', '5', 2);
  assert.equal(replaceScale2.digits, '5');
  assert.equal(replaceScale2.formatted, '0,05');
});

test('validação estrita do hodômetro em km escala 0 (nunca aceitar decimais em km)', () => {
  assert.equal(parseArbitraryInputToDigits('120542', 0), '120542');
  assert.equal(parseArbitraryInputToDigits('120.542', 0), '120542');
  assert.equal(parseArbitraryInputToDigits('120542 km', 0), '120542');
  assert.equal(parseArbitraryInputToDigits('0', 0), '0');

  // Decimais em km são inválidos e rejeitados
  assert.equal(parseArbitraryInputToDigits('12.5', 0), null);
  assert.equal(parseArbitraryInputToDigits('12,5', 0), null);
  assert.equal(parseArbitraryInputToDigits('120,542', 0), null);
});

test('tratamento de zeros consecutivos', () => {
  let res = applyNumericMaskChange('', '', '0', 3);
  assert.equal(res.digits, '0');
  assert.equal(res.formatted, '0,000');

  // Digitar outro zero não acumula 00
  res = applyNumericMaskChange(res.digits, res.formatted, res.formatted + '0', 3);
  assert.equal(res.digits, '0');
  assert.equal(res.formatted, '0,000');

  // Digitar 5 substitui zero inicial
  res = applyNumericMaskChange(res.digits, res.formatted, res.formatted + '5', 3);
  assert.equal(res.digits, '5');
  assert.equal(res.formatted, '0,005');

  // Backspace em 0,000 esvazia o campo
  res = applyNumericMaskChange('0', '0,000', '0,00', 3);
  assert.equal(res.digits, '');
  assert.equal(res.formatted, '');
});

test('colar valores válidos, unidades e inteiros sem reinterpretação', () => {
  // Inteiro 35 em litros representa 35 L = 35,000 (não 0,035)
  assert.equal(parseArbitraryInputToDigits('35', 3), '35000');
  assert.equal(formatDigitsToDisplay(parseArbitraryInputToDigits('35', 3), 3), '35,000');

  // Decimal com vírgula
  assert.equal(parseArbitraryInputToDigits('35,125', 3), '35125');
  assert.equal(formatDigitsToDisplay(parseArbitraryInputToDigits('35,125', 3), 3), '35,125');

  // Decimal com ponto
  assert.equal(parseArbitraryInputToDigits('35.125', 3), '35125');
  assert.equal(formatDigitsToDisplay(parseArbitraryInputToDigits('35.125', 3), 3), '35,125');

  // Com unidade e moeda
  assert.equal(parseArbitraryInputToDigits('35,125 L', 3), '35125');
  assert.equal(parseArbitraryInputToDigits('R$ 150,00', 2), '15000');
  assert.equal(formatDigitsToDisplay(parseArbitraryInputToDigits('R$ 150,00', 2), 2), '150,00');

  // Separador de milhar
  assert.equal(parseArbitraryInputToDigits('1.250,50', 2), '125050');
  assert.equal(formatDigitsToDisplay(parseArbitraryInputToDigits('1.250,50', 2), 2), '1250,50');

  // Preço por litro
  assert.equal(parseArbitraryInputToDigits('5,4321', 4), '54321');
  assert.equal(parseArbitraryInputToDigits('5.4321', 4), '54321');
  assert.equal(parseArbitraryInputToDigits('5', 4), '50000');
  assert.equal(formatDigitsToDisplay(parseArbitraryInputToDigits('5', 4), 4), '5,0000');
});
