import { test, expect } from '@playwright/test';
import { apiURL, createAccount, createVehicle, fuelEntry } from './api-fixtures';

test('fixtures reais: decimais, ciclo cheio/parcial, reenvio e isolamento', async ({ request }) => {
  const owner = await createAccount(request);
  const other = await createAccount(request);
  const vehicle = await createVehicle(request, owner.headers);
  const entries = [fuelEntry(1000, 'FULL', 3), fuelEntry(1100, 'PARTIAL', 2), fuelEntry(1200, 'FULL', 1)];
  for (const entry of entries) {
    const result = await request.post(`${apiURL}/vehicles/${vehicle.id}/fuel-entries`, {
      headers: owner.headers, data: entry,
    });
    expect(result.status()).toBe(201);
  }
  const replay = await request.post(`${apiURL}/vehicles/${vehicle.id}/fuel-entries`, {
    headers: owner.headers, data: entries[2],
  });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).idempotentReplay).toBe(true);

  const summary = await request.get(`${apiURL}/vehicles/${vehicle.id}/summary`, { headers: owner.headers });
  expect(summary.status()).toBe(200);
  expect(await summary.json()).toMatchObject({
    purchaseCount: 3, paidTotal: '165.00', purchasedLiters: '30.375',
    validCycleCount: 1, cycleDistanceKm: 200, cycleLiters: '20.250',
    periodConsumptionKmPerLiter: '9.88',
  });
  for (const resource of ['', '/summary', '/fuel-entries', `/fuel-entries/${entries[0].id}`]) {
    const response = await request.get(`${apiURL}/vehicles/${vehicle.id}${resource}`, { headers: other.headers });
    expect(response.status()).toBe(404);
  }
});
