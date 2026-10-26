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

export function fuelEntry(odometerKm: number, tankState: 'FULL' | 'PARTIAL', daysAgo: number) {
  const occurredAt = new Date();
  occurredAt.setUTCDate(occurredAt.getUTCDate() - daysAgo);
  occurredAt.setUTCHours(12, 0, 0, 0);
  return {
    id: randomUUID(), occurredAt: occurredAt.toISOString(), timezone: 'America/Sao_Paulo',
    odometerKm, fuelType: 'GASOLINE_REGULAR', liters: '10.125', unitPrice: '5.4321',
    paidTotal: '55.00', tankState, historyGapBefore: false, stationName: 'Posto E2E',
    latitude: -23.55052, longitude: -46.633308,
  };
}
