import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPeriod, datasetSignature, plotGeometry, visibleDrawing, DashboardCache } from '../src/features/home/dashboard/model.ts';

test('period uses user civil month, includes 3/6 calendar months and no fixed dates', () => {
  const now = new Date('2026-11-01T02:30:00Z');
  assert.deepEqual(dashboardPeriod(3, 'America/Sao_Paulo', now), { from: '2026-08-01', to: '2026-10-31', label: '3 meses' });
  assert.deepEqual(dashboardPeriod(1, 'UTC', now), { from: '2026-11-01', to: '2026-11-30', label: 'Novembro 2026' });
});
test('drawing eligibility excludes title/filter, header and dock', () => {
  assert.equal(visibleDrawing(500, 200, 0, 600, 150, 104), false);
  assert.equal(visibleDrawing(500, 200, 250, 600, 150, 104), true);
  assert.equal(visibleDrawing(500, 200, 600, 600, 150, 104), false);
});
test('line geometry keeps null gaps and linear segments instead of invented zeroes', () => {
  const geometry = plotGeometry([2, null, 4], 300, 180, false);
  assert.equal(geometry.points[1], null);
  assert.equal(geometry.path.includes('NaN'), false);
  assert.equal(geometry.path.split('M').length - 1, 2);
  assert.equal(geometry.max > geometry.min, true);
});
test('canonical signature ignores object property order but tracks content and params', () => {
  assert.equal(datasetSignature({ b: 2, a: [1, null] }), datasetSignature({ a: [1, null], b: 2 }));
  assert.notEqual(datasetSignature({ a: [1, null] }), datasetSignature({ a: [1, 0] }));
});
test('cache deduplicates concurrent requests and retry evicts errors', async () => {
  const cache = new DashboardCache(); let calls = 0;
  const read = () => { calls++; return Promise.resolve({ paidTotal: '3.00' }); };
  const [a,b] = await Promise.all([cache.read('u:v:range', read), cache.read('u:v:range', read)]);
  assert.equal(calls, 1); assert.equal(a,b);
  await assert.rejects(cache.read('bad', () => Promise.reject(new Error('offline'))));
  assert.equal(await cache.read('bad', () => Promise.resolve('recovered')), 'recovered');
});
