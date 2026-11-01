import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';

export const apiURL = process.env.FUELLOG_API_URL ?? 'http://127.0.0.1:8080/api/v1';
export const password = 'FuelLog-test-2026!';

export async function createAccount(request: APIRequestContext) {
  const account = { name: 'Teste E2E', email: `e2e-${randomUUID()}@example.test`, password };
  const registered = await request.post(`${apiURL}/auth/register`, { data: account });
  expect(registered.status()).toBe(201);
  const login = await request.post(`${apiURL}/auth/login`, { data: { email: account.email, password } });
  expect(login.status()).toBe(200);
  const tokens = await login.json();
  return { ...account, tokens, headers: { Authorization: `Bearer ${tokens.access_token}` } };
}

export async function createVehicle(request: APIRequestContext, headers: Record<string, string>, nickname = 'Carro E2E') {
  const response = await request.post(`${apiURL}/vehicles`, {
    headers, data: { nickname, allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'] },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

export function fuelEntry(odometerKm: number, daysAgo: number) {
  const occurredAt = new Date();
  occurredAt.setUTCDate(occurredAt.getUTCDate() - daysAgo);
  occurredAt.setUTCHours(12, 0, 0, 0);
  return {
    id: randomUUID(), occurredAt: occurredAt.toISOString(), timezone: 'America/Sao_Paulo',
    odometerKm, fuelType: 'GASOLINE_REGULAR', liters: '10.125', unitPrice: '5.4321',
    paidTotal: '55.00',
    latitude: -23.55052, longitude: -46.633308,
  };
}

// Dashboard fixture for journeys focused on purchase actions rather than chart datasets.
export function purchaseDashboard(summary = { purchaseCount: 0, paidTotal: '0.00', purchasedLiters: '0.000' }) {
  return { vehicleId: 'fixture-vehicle', from: null, to: null, timezone: 'America/Sao_Paulo', fuelType: null,
    ...summary, weightedUnitPrice: null, months: [], fuels: [], prices: [] };
}

export function fuelHistoryPage<T extends { occurredAt: string; paidTotal: string; liters: string }>(
  entries: T[], page = 0, size = 20, timezone = 'America/Sao_Paulo',
) {
  const sum = (field: 'paidTotal' | 'liters', scale: number) => {
    const total = entries.reduce((value, entry) => {
      const [whole, fraction = ''] = entry[field].split('.');
      return value + BigInt(whole + fraction.padEnd(scale, '0'));
    }, 0n).toString().padStart(scale + 1, '0');
    return `${total.slice(0, -scale)}.${total.slice(-scale)}`;
  };
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: timezone }).formatToParts(new Date(entry.occurredAt));
    const month = `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}`;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return { items: entries.slice(page * size, (page + 1) * size), page, size, totalElements: entries.length, totalPages: Math.ceil(entries.length / size),
    summary: { paidTotal: sum('paidTotal', 2), purchasedLiters: sum('liters', 3) },
    monthlyCounts: [...counts].sort(([a], [b]) => b.localeCompare(a)).map(([month, purchaseCount]) => ({ month, purchaseCount })) };
}
