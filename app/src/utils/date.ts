const MONTHS_PT = [
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

const MONTHS_SHORT_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

const WEEKDAYS_PT = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

export interface MonthPeriodOption {
  monthKey: string;
  label: string;
  from: string;
  to: string;
}

export function getDeviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz.includes('/')) return tz;
  } catch {
    // Fallback
  }
  return 'America/Sao_Paulo';
}

export const detectDeviceTimezone = getDeviceTimezone;

export function getCurrentMonthKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getMonthRange(monthKey: string): {
  from: string;
  to: string;
  label: string;
  monthName: string;
} {
  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr) || new Date().getFullYear();
  const monthIndex = Math.max(0, Math.min(11, (Number(mStr) || 1) - 1));
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(lastDay).padStart(2, '0');
  const monthName = MONTHS_PT[monthIndex];
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${dd}`,
    label: `${monthName} ${year}`,
    monthName,
  };
}

export function getMonthPeriodOption(monthsAgo = 0, baseDate = new Date()): MonthPeriodOption {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth() - monthsAgo, 1);
  const monthKey = getCurrentMonthKey(d);
  const { from, to, label } = getMonthRange(monthKey);
  return { monthKey, label, from, to };
}

export function listRecentMonthPeriods(count = 12): MonthPeriodOption[] {
  const options: MonthPeriodOption[] = [];
  for (let i = 0; i < count; i += 1) {
    options.push(getMonthPeriodOption(i));
  }
  return options;
}

export function getRecentMonthOptions(
  count = 12,
): Array<{ key: string; label: string }> {
  return listRecentMonthPeriods(count).map((opt) => ({
    key: opt.monthKey,
    label: opt.label,
  }));
}

export function toIsoWithLocalOffset(date: Date): string {
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  const tzOffsetMin = -date.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const offsetHours = pad(Math.floor(Math.abs(tzOffsetMin) / 60));
  const offsetMinutes = pad(Math.abs(tzOffsetMin) % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMinutes}`;
}

export function formatLocalDateInput(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatLocalTimeInput(date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

export function parseLocalDateTimeToIso(
  dateStr: string,
  timeStr: string,
): string | null {
  const trimmedDate = dateStr.trim();
  const trimmedTime = timeStr.trim();

  // Aceita AAAA-MM-DD ou DD/MM/AAAA
  let year: number;
  let month: number;
  let day: number;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedDate);
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmedDate);

  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (brMatch) {
    day = Number(brMatch[1]);
    month = Number(brMatch[2]);
    year = Number(brMatch[3]);
  } else {
    return null;
  }

  const timeMatch = /^(\d{2}):(\d{2})$/.exec(trimmedTime);
  if (!timeMatch) {
    return null;
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const constructed = new Date(year, month - 1, day, hour, minute, 0);
  if (
    constructed.getFullYear() !== year ||
    constructed.getMonth() !== month - 1 ||
    constructed.getDate() !== day
  ) {
    return null;
  }

  return toIsoWithLocalOffset(constructed);
}

export function parseBrDateTimeInput(
  dateBr: string,
  timeBr: string,
): { valid: boolean; occurredAtIso: string | null; error?: string } {
  const iso = parseLocalDateTimeToIso(dateBr, timeBr);
  if (!iso) {
    return {
      valid: false,
      occurredAtIso: null,
      error: 'Data ou hora inválida.',
    };
  }
  return { valid: true, occurredAtIso: iso };
}

export function formatDateToBrInput(
  date = new Date(),
): { dateBr: string; timeBr: string } {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return {
    dateBr: `${dd}/${mm}/${yyyy}`,
    timeBr: `${hh}:${min}`,
  };
}

export function formatIsoShortDayMonth(isoStr: string): {
  dayMonth: string;
  weekday: string;
  monthHeading: string;
  fullDateTime: string;
} {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) {
    return {
      dayMonth: '—',
      weekday: '',
      monthHeading: 'Registros',
      fullDateTime: isoStr,
    };
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const shortMonth = MONTHS_SHORT_PT[d.getMonth()] || '';
  const weekday = WEEKDAYS_PT[d.getDay()] || '';
  const monthHeading = `${MONTHS_PT[d.getMonth()] || 'Mês'} ${yyyy}`;
  return {
    dayMonth: `${dd} ${shortMonth}`,
    weekday,
    monthHeading,
    fullDateTime: `${dd}/${mm}/${yyyy} às ${hh}:${min}`,
  };
}

export function formatDateTimeRowBR(isoStr: string, _timezone?: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  const dd = String(d.getDate()).padStart(2, '0');
  const shortMonth = MONTHS_SHORT_PT[d.getMonth()] || '';
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd} ${shortMonth}, ${hh}:${min}`;
}

export function formatDateTimeFullBR(isoStr: string, _timezone?: string): string {
  return formatIsoShortDayMonth(isoStr).fullDateTime;
}

export function groupMonthLabelBR(isoStr: string, _timezone?: string): string {
  return formatIsoShortDayMonth(isoStr).monthHeading;
}
