export const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export const WEEKDAY_HEADERS_PT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export interface CalendarDayCell {
  dateStr: string;
  dayNumber: number;
}

export function isLeapYear(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

export function getDaysInMonth(year: number, monthIndex: number): number {
  if (monthIndex < 0 || monthIndex > 11) {
    throw new Error(`monthIndex inválido: ${monthIndex}`);
  }
  if (monthIndex === 1) {
    return isLeapYear(year) ? 29 : 28;
  }
  if ([3, 5, 8, 10].includes(monthIndex)) {
    return 30;
  }
  return 31;
}

export function formatIsoDate(year: number, month1Based: number, day: number): string {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month1Based).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseIsoDate(isoStr: string): { year: number; monthIndex: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoStr.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (monthIndex < 0 || monthIndex > 11 || day < 1) return null;
  const maxDays = getDaysInMonth(year, monthIndex);
  if (day > maxDays) return null;
  return { year, monthIndex, day };
}

export function isValidIsoDate(isoStr: string): boolean {
  return parseIsoDate(isoStr) !== null;
}

export function formatDisplayDateBR(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const parts = parseIsoDate(isoDate);
  if (!parts) return isoDate;
  const dd = String(parts.day).padStart(2, '0');
  const mm = String(parts.monthIndex + 1).padStart(2, '0');
  return `${dd}/${mm}/${parts.year}`;
}

export function formatPeriodSummaryBR(from: string | null | undefined, to: string | null | undefined): string {
  if (!from && !to) return 'Todo o histórico';
  if (from && to) return `${formatDisplayDateBR(from)} — ${formatDisplayDateBR(to)}`;
  if (from) return `A partir de ${formatDisplayDateBR(from)}`;
  return `Até ${formatDisplayDateBR(to)}`;
}

export function getStartWeekdayOffset(year: number, monthIndex: number): number {
  const d = new Date(year, monthIndex, 1);
  return (d.getDay() + 6) % 7;
}

export function getMonthHeaderLabel(year: number, monthIndex: number): string {
  const name = MONTH_NAMES_PT[monthIndex] || '';
  return `${name} ${year}`;
}

export function getCalendarGridDays(year: number, monthIndex: number): Array<CalendarDayCell | null> {
  const offset = getStartWeekdayOffset(year, monthIndex);
  const totalDays = getDaysInMonth(year, monthIndex);
  const cells: Array<CalendarDayCell | null> = [];

  for (let i = 0; i < offset; i++) {
    cells.push(null);
  }

  for (let d = 1; d <= totalDays; d++) {
    cells.push({
      dateStr: formatIsoDate(year, monthIndex + 1, d),
      dayNumber: d,
    });
  }

  return cells;
}

export function handleDateRangeClick(
  currentStart: string | null,
  currentEnd: string | null,
  clickedDate: string,
): { start: string; end: string | null } {
  if (!currentStart || (currentStart && currentEnd)) {
    return { start: clickedDate, end: null };
  }

  if (clickedDate < currentStart) {
    return { start: clickedDate, end: null };
  }

  return { start: currentStart, end: clickedDate };
}

export function isDateStart(date: string, start: string | null): boolean {
  return Boolean(start && date === start);
}

export function isDateEnd(date: string, end: string | null): boolean {
  return Boolean(end && date === end);
}

export function isDateInRange(date: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  return date > start && date < end;
}

export function getPreviousMonth(year: number, monthIndex: number): { year: number; monthIndex: number } {
  if (monthIndex === 0) {
    return { year: year - 1, monthIndex: 11 };
  }
  return { year, monthIndex: monthIndex - 1 };
}

export function getNextMonth(year: number, monthIndex: number): { year: number; monthIndex: number } {
  if (monthIndex === 11) {
    return { year: year + 1, monthIndex: 0 };
  }
  return { year, monthIndex: monthIndex + 1 };
}
