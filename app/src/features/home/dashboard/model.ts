export interface DashboardPeriod { from: string | null; to: string | null; label: string }

export function dashboardPeriod(months: number, timezone: string, now = new Date()): DashboardPeriod {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: 'numeric' }).formatToParts(now);
  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  const start = new Date(Date.UTC(year, month - months, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(end).replace(' de ', ' ');
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10),
    label: months === 1 ? monthLabel[0].toUpperCase() + monthLabel.slice(1) : `${months} meses` };
}

export function datasetSignature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(datasetSignature).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
    .map(([key,item]) => `${JSON.stringify(key)}:${datasetSignature(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function visibleDrawing(top: number, height: number, scroll: number, viewport: number, header: number, dock: number): boolean {
  'worklet';
  const intersection = Math.min(top + height - scroll, viewport - dock) - Math.max(top - scroll, header);
  return intersection >= Math.min(height * 0.35, 80);
}

export function plotGeometry(values: (number | null)[], width: number, height: number, bars: boolean) {
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const low = valid.length ? Math.min(...valid) : 0;
  const high = valid.length ? Math.max(...valid) : 1;
  const margin = high === low ? Math.max(high * 0.1, 0.1) : (high - low) * 0.15;
  const min = bars ? 0 : Math.max(0, low - margin);
  const max = bars ? Math.max(high * 1.15, 1) : high + margin;
  const left = 52, right = Math.max(left + 1, width - 14), bottom = height - 30, top = 16;
  const points = values.map((value, index) => value === null || !Number.isFinite(value) ? null : ({
    x: values.length === 1 ? (left + right) / 2 : left + index * (right - left) / Math.max(1, values.length - 1),
    y: bottom - (value - min) / (max - min) * (bottom - top),
  }));
  let path = '', continuous = false;
  for (const point of points) {
    if (!point) { continuous = false; continue; }
    path += `${continuous ? 'L' : 'M'}${point.x},${point.y} `; continuous = true;
  }
  return { points, path, min, max, left, right, top, bottom };
}

export class DashboardCache {
  private values = new Map<string, Promise<unknown>>();
  read<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached) return cached as Promise<T>;
    const pending = fetcher().catch(error => { if (this.values.get(key) === pending) this.values.delete(key); throw error; });
    this.values.set(key, pending);
    return pending;
  }
  evict(key: string) { this.values.delete(key); }
}
