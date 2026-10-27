/**
 * Helper local para edição de abastecimento no FuelLog:
 * - Conversão de data/hora no fuso horário do registro
 * - Remoção de zeros insignificantes para determinação correta de precisão de máscara
 */

export function stripInsignificantZeros(value: string | null | undefined): string {
  if (!value) return '';
  const str = String(value).trim();
  const dotIndex = str.indexOf('.');
  if (dotIndex < 0) return str;
  const intPart = str.slice(0, dotIndex);
  const fracPart = str.slice(dotIndex + 1).replace(/0+$/, '');
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
}

export function countSignificantDecimals(value: string | null | undefined): number {
  if (!value) return 0;
  const str = String(value).trim();
  const dotIndex = str.indexOf('.');
  if (dotIndex < 0) return 0;
  const fracPart = str.slice(dotIndex + 1).replace(/0+$/, '');
  return fracPart.length;
}

export function formatEntryDateForInput(
  iso: string,
  timeZone?: string,
): { dateStr: string; timeStr: string } {
  const tz = timeZone || 'America/Sao_Paulo';
  try {
    const d = new Date(iso);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value ?? '';
    const m = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    let hh = parts.find((p) => p.type === 'hour')?.value ?? '';
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '';
    if (hh === '24') hh = '00';
    return {
      dateStr: `${y}-${m}-${day}`,
      timeStr: `${hh}:${mm}`,
    };
  } catch {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    let hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    if (hh === '24') hh = '00';
    return {
      dateStr: `${yyyy}-${mm}-${dd}`,
      timeStr: `${hh}:${min}`,
    };
  }
}

export function parseDateTimeInTimezone(
  dateStr: string,
  timeStr: string,
  timeZone = 'America/Sao_Paulo',
): string | null {
  const trimmedDate = dateStr.trim();
  const trimmedTime = timeStr.trim();

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

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(trimmedTime);
  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour === 24 && minute === 0) {
    hour = 0;
  }

  if (
    year < 1900 ||
    year > 2100 ||
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

  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return null;

  const tz = timeZone || 'America/Sao_Paulo';
  const targetUtcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const getParts = (timestamp: number) => {
    const dObj = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    });
    const p = formatter.formatToParts(dObj);
    const get = (type: string) => Number(p.find((x) => x.type === type)?.value || 0);
    let h = get('hour');
    if (h === 24) h = 0;
    return Date.UTC(get('year'), get('month') - 1, get('day'), h, get('minute'), get('second'));
  };

  try {
    let current = targetUtcGuess;
    for (let i = 0; i < 3; i++) {
      const formatted = getParts(current);
      const diff = formatted - targetUtcGuess;
      if (diff === 0) break;
      current -= diff;
    }
    if (getParts(current) !== targetUtcGuess) {
      return null;
    }
    return new Date(current).toISOString();
  } catch {
    return null;
  }
}
