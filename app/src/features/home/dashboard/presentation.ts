import { FUEL_TYPE_LABELS, UNAVAILABLE_REASON_EXPLANATIONS } from '@/api/endpoints';
import type { DashboardResponse, FuelType } from '@/api/types';
import { formatCurrencyBRL, formatDecimalBR, formatLitersBR, formatOdometerBR, formatUnitPriceBR } from '@/utils/decimal';
import type { DashboardPeriod } from './model';

export type ChartKind = 'spending' | 'fuel' | 'consumption' | 'cost' | 'price' | 'liters';
export const CHART_TITLES: Record<ChartKind, string> = { spending: 'Gastos por mês', fuel: 'Gasto por combustível',
  consumption: 'Rendimento por ciclo', cost: 'Custo por quilômetro', price: 'Evolução do preço por litro', liters: 'Litros por mês' };
export interface HistoryScope { from: string | null; to: string | null; fuelType?: FuelType | null; occurredFrom?: string; occurredTo?: string; entryId?: string }
export interface ChartDatum { id: string; label: string; title: string; value: string | null; formatted: string;
  fields: [string, string][]; history: HistoryScope; fuelType?: FuelType; mixed?: boolean }
export function civilDate(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function dateLabel(instant: string, timezone: string, year = false) {
  const label = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: 'short', ...(year?{year:'numeric' as const}:{}) }).format(new Date(instant)).replace('.', '');
  return year ? label : label.replace(' de ', ' ');
}
export function chartValue(kind: ChartKind, value: string | null): string {
  if (value === null) return 'Indisponível';
  if (kind === 'consumption') return `${formatDecimalBR(value, 2, 2)} km/L`;
  if (kind === 'cost') return `${formatUnitPriceBR(value)}/km`;
  if (kind === 'price') return `${formatUnitPriceBR(value)}/L`;
  if (kind === 'liters') return formatLitersBR(value);
  return formatCurrencyBRL(value);
}
export function chartRows(kind: ChartKind, data: DashboardResponse, period: DashboardPeriod, fuel: FuelType | null): ChartDatum[] {
  if (kind === 'spending' || kind === 'liters') return data.months.map(month => {
    const title = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month.month}-01T12:00:00Z`));
    const value = kind === 'spending' ? month.paidTotal : month.liters;
    return { id: month.month, title, label: new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'short' }).format(new Date(`${month.month}-01T12:00:00Z`)).replace('.', '') + `\n${month.month.slice(0,4)}`,
      value, formatted: chartValue(kind, value), fields: [['Total pago', formatCurrencyBRL(month.paidTotal)], ['Abastecimentos', String(month.purchaseCount)], ['Litros', formatLitersBR(month.liters)]],
      history: { from: month.from, to: month.to, fuelType: fuel } };
  });
  if (kind === 'fuel') return data.fuels.map(item => ({ id: item.fuelType, label: FUEL_TYPE_LABELS[item.fuelType], title: FUEL_TYPE_LABELS[item.fuelType],
    fuelType: item.fuelType, value: item.paidTotal, formatted: chartValue(kind, item.paidTotal),
    fields: [['Total pago', formatCurrencyBRL(item.paidTotal)], ['Participação nos gastos', item.percentage === null ? 'Indisponível' : `${formatDecimalBR(item.percentage,2,4)}%`],
      ['Abastecimentos', String(item.purchaseCount)], ['Litros', formatLitersBR(item.liters)]],
    history: { from: period.from, to: period.to, fuelType: item.fuelType } }));
  if (kind === 'price') return data.prices.map(item => ({ id: item.entryId, label: dateLabel(item.occurredAt, data.timezone),
    title: `${dateLabel(item.occurredAt, data.timezone,true)} · ${FUEL_TYPE_LABELS[item.fuelType]}`, value: item.unitPrice, fuelType: item.fuelType,
    formatted: chartValue(kind, item.unitPrice), fields: [['Data', new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: data.timezone }).format(new Date(item.occurredAt))],
      ['Combustível', FUEL_TYPE_LABELS[item.fuelType]], ['Preço declarado por litro', chartValue(kind, item.unitPrice)], ['Litros', formatLitersBR(item.liters)], ['Total pago', formatCurrencyBRL(item.paidTotal)]],
    history: { from: civilDate(item.occurredAt,data.timezone), to: civilDate(item.occurredAt,data.timezone), fuelType: item.fuelType, entryId: item.entryId } }));
  return data.cycles.map(cycle => {
    const value = kind === 'consumption' ? cycle.consumptionKmPerLiter : cycle.replacementCostPerKm;
    const title = `${dateLabel(cycle.startedAt,data.timezone,true)} a ${dateLabel(cycle.endedAt,data.timezone,true)}${cycle.mixed ? ' · Ciclo misto' : ''}`;
    return { id: cycle.endEntryId, title, label: dateLabel(cycle.endedAt,data.timezone), value, formatted: chartValue(kind,value), mixed: cycle.mixed,
      fields: [['Início', new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short', timeZone: data.timezone }).format(new Date(cycle.startedAt))],
        ['Fim', new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short', timeZone: data.timezone }).format(new Date(cycle.endedAt))],
        ['Rendimento', chartValue('consumption',cycle.consumptionKmPerLiter)], ['Custo por quilômetro', chartValue('cost',cycle.replacementCostPerKm)],
        ['Distância considerada', formatOdometerBR(cycle.distanceKm)], ['Litros considerados', formatLitersBR(cycle.liters)], ['Gasto considerado', formatCurrencyBRL(cycle.paidTotal)],
        ['Combustíveis', cycle.fuelTypes.map(type => FUEL_TYPE_LABELS[type]).join(', ')],
        ...(cycle.unavailableReason ? [['Ciclo indisponível', UNAVAILABLE_REASON_EXPLANATIONS[cycle.unavailableReason].description] as [string,string]] : [])],
      history: { from: civilDate(cycle.startedAt,data.timezone), to: civilDate(cycle.endedAt,data.timezone),
        occurredFrom: cycle.startedAt, occurredTo: cycle.endedAt, fuelType: null } };
  });
}
