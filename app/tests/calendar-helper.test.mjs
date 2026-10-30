import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLeapYear,
  getDaysInMonth,
  formatIsoDate,
  parseIsoDate,
  formatDisplayDateBR,
  formatPeriodSummaryBR,
  getStartWeekdayOffset,
  getMonthHeaderLabel,
  getCalendarGridDays,
  handleDateRangeClick,
  isDateStart,
  isDateEnd,
  isDateInRange,
  getPreviousMonth,
  getNextMonth,
} from '../src/features/history/helpers/calendarHelper.ts';

test('ano bissexto regras gregorianas corretas', () => {
  assert.equal(isLeapYear(2024), true, '2024 é bissexto divisível por 4');
  assert.equal(isLeapYear(2028), true, '2028 é bissexto');
  assert.equal(isLeapYear(2000), true, '2000 é bissexto secular divisível por 400');
  assert.equal(isLeapYear(2400), true, '2400 é bissexto');
  assert.equal(isLeapYear(2026), false, '2026 não é bissexto');
  assert.equal(isLeapYear(1900), false, '1900 secular não divisível por 400');
  assert.equal(isLeapYear(2100), false, '2100 secular não divisível por 400');
});

test('dias no mês para bissexto e regular', () => {
  // Fevereiro
  assert.equal(getDaysInMonth(2024, 1), 29, 'Fev 2024 tem 29 dias');
  assert.equal(getDaysInMonth(2026, 1), 28, 'Fev 2026 tem 28 dias');
  assert.equal(getDaysInMonth(2000, 1), 29, 'Fev 2000 tem 29 dias');
  assert.equal(getDaysInMonth(1900, 1), 28, 'Fev 1900 tem 28 dias');

  // Meses de 30 dias: Abr(3), Jun(5), Set(8), Nov(10)
  assert.equal(getDaysInMonth(2026, 3), 30);
  assert.equal(getDaysInMonth(2026, 5), 30);
  assert.equal(getDaysInMonth(2026, 8), 30);
  assert.equal(getDaysInMonth(2026, 10), 30);

  // Meses de 31 dias: Jan(0), Mar(2), Mai(4), Jul(6), Ago(7), Out(9), Dez(11)
  assert.equal(getDaysInMonth(2026, 0), 31);
  assert.equal(getDaysInMonth(2026, 2), 31);
  assert.equal(getDaysInMonth(2026, 4), 31);
  assert.equal(getDaysInMonth(2026, 6), 31);
  assert.equal(getDaysInMonth(2026, 7), 31);
  assert.equal(getDaysInMonth(2026, 9), 31);
  assert.equal(getDaysInMonth(2026, 11), 31);
});

test('alinhamento de dia da semana na segunda-feira (Seg=0, Dom=6)', () => {
  // Outubro de 2026 começou em 01/10/2026 que foi Quinta-feira (Qui = index 3)
  const offsetOct2026 = getStartWeekdayOffset(2026, 9);
  assert.equal(offsetOct2026, 3, '01/10/2026 inicia na Quinta (offset 3)');

  // 01/02/2026 é Domingo (index 6)
  const offsetFeb2026 = getStartWeekdayOffset(2026, 1);
  assert.equal(offsetFeb2026, 6, '01/02/2026 inicia no Domingo (offset 6)');

  // 01/06/2026 é Segunda (index 0)
  const offsetJun2026 = getStartWeekdayOffset(2026, 5);
  assert.equal(offsetJun2026, 0, '01/06/2026 inicia na Segunda (offset 0)');
});

test('grid mensal com offsets e células válidas', () => {
  const grid = getCalendarGridDays(2026, 9);
  // 3 slots nulos para Seg, Ter, Qua
  assert.equal(grid[0], null);
  assert.equal(grid[1], null);
  assert.equal(grid[2], null);
  // Dia 1 na Quinta
  assert.deepEqual(grid[3], { dateStr: '2026-10-01', dayNumber: 1 });
  // Total de células = 3 + 31 = 34
  assert.equal(grid.length, 34);
  assert.deepEqual(grid[33], { dateStr: '2026-10-31', dayNumber: 31 });
});

test('seleção de intervalo de datas no calendário', () => {
  // 1º toque define data inicial
  const step1 = handleDateRangeClick(null, null, '2026-10-01');
  assert.deepEqual(step1, { start: '2026-10-01', end: null });

  // 2º toque em data posterior completa intervalo
  const step2 = handleDateRangeClick(step1.start, step1.end, '2026-10-30');
  assert.deepEqual(step2, { start: '2026-10-01', end: '2026-10-30' });

  // 3º toque após intervalo completo reinicia com nova data inicial
  const step3 = handleDateRangeClick(step2.start, step2.end, '2026-10-15');
  assert.deepEqual(step3, { start: '2026-10-15', end: null });

  // Toque em data anterior à inicial redefine a data inicial
  const backwardClick = handleDateRangeClick('2026-10-20', null, '2026-10-05');
  assert.deepEqual(backwardClick, { start: '2026-10-05', end: null });

  // Toque na mesma data define início e fim no mesmo dia
  const sameDay = handleDateRangeClick('2026-10-10', null, '2026-10-10');
  assert.deepEqual(sameDay, { start: '2026-10-10', end: '2026-10-10' });
});

test('testes de pertinência ao intervalo inclusivo', () => {
  const start = '2026-10-01';
  const end = '2026-10-30';

  assert.equal(isDateStart('2026-10-01', start), true);
  assert.equal(isDateStart('2026-10-02', start), false);

  assert.equal(isDateEnd('2026-10-30', end), true);
  assert.equal(isDateEnd('2026-10-29', end), false);

  // Inclusão estrita intermediária
  assert.equal(isDateInRange('2026-10-01', start, end), false);
  assert.equal(isDateInRange('2026-10-15', start, end), true);
  assert.equal(isDateInRange('2026-10-29', start, end), true);
  assert.equal(isDateInRange('2026-10-30', start, end), false);
  assert.equal(isDateInRange('2026-10-31', start, end), false);
});

test('formatação de resumo e datas para visual BR', () => {
  assert.equal(formatDisplayDateBR('2026-10-01'), '01/10/2026');
  assert.equal(formatDisplayDateBR('2026-10-30'), '30/10/2026');
  assert.equal(formatDisplayDateBR(null), '—');

  assert.equal(formatPeriodSummaryBR('2026-10-01', '2026-10-30'), '01/10/2026 — 30/10/2026');
  assert.equal(formatPeriodSummaryBR(null, null), 'Todo o histórico');
  assert.equal(formatPeriodSummaryBR('2026-10-01', null), 'A partir de 01/10/2026');
  assert.equal(formatPeriodSummaryBR(null, '2026-10-30'), 'Até 30/10/2026');
});

test('navegação entre meses com transição de ano', () => {
  // Transição de Janeiro para Dezembro anterior
  const decPrev = getPreviousMonth(2026, 0);
  assert.deepEqual(decPrev, { year: 2025, monthIndex: 11 });

  // Transição de Dezembro para Janeiro seguinte
  const janNext = getNextMonth(2026, 11);
  assert.deepEqual(janNext, { year: 2027, monthIndex: 0 });

  // Mês comum
  assert.deepEqual(getNextMonth(2026, 8), { year: 2026, monthIndex: 9 });
  assert.deepEqual(getPreviousMonth(2026, 9), { year: 2026, monthIndex: 8 });
  assert.equal(getMonthHeaderLabel(2026, 9), 'Outubro 2026');
});

test('validação estrita de datas impossíveis no parseIsoDate', () => {
  assert.equal(parseIsoDate('2023-02-29'), null, '2023 não é bissexto: 29 de fev é inválido');
  assert.equal(parseIsoDate('2024-04-31'), null, 'Abril tem 30 dias: dia 31 é inválido');
  assert.equal(parseIsoDate('2026-06-31'), null, 'Junho tem 30 dias: dia 31 é inválido');
  assert.equal(parseIsoDate('2026-02-29'), null, '2026-02-29 é inválido');
  assert.equal(parseIsoDate('2026-13-01'), null, 'Mês 13 é inválido');
  assert.equal(parseIsoDate('2026-00-10'), null, 'Mês 0 é inválido');
  assert.equal(parseIsoDate('2026-05-00'), null, 'Dia 0 é inválido');

  // Válidos
  assert.deepEqual(parseIsoDate('2024-02-29'), { year: 2024, monthIndex: 1, day: 29 });
  assert.deepEqual(parseIsoDate('2026-02-28'), { year: 2026, monthIndex: 1, day: 28 });
  assert.deepEqual(parseIsoDate('2026-10-31'), { year: 2026, monthIndex: 9, day: 31 });
});
