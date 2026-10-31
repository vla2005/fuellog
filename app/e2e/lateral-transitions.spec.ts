import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Frontend-only mocks: no real accounts or writes to the API.
const vehicle = {
  id: 'motion-vehicle', nickname: 'Carro teste', brand: 'Fiat', model: 'Uno',
  allowedFuels: ['GASOLINE_REGULAR'], currentOdometerKm: 1000,
  tankCapacityLiters: '50', version: 1, archivedAt: null,
};
const entry = {
  id: 'motion-entry', vehicleId: vehicle.id, occurredAt: '2026-10-24T12:00:00Z',
  timezone: 'America/Sao_Paulo', odometerKm: 1000, fuelType: 'GASOLINE_REGULAR',
  liters: '10.000', unitPrice: '5.0000', paidTotal: '50.00', referenceTotal: '50.00',
  adjustmentAmount: '0.00', tankState: 'FULL', historyGapBefore: false,
  stationName: 'Posto teste', notes: '', version: 1,
};

async function mockApi(page: Page, authenticated = true) {
  if (authenticated) await page.addInitScript(() => {
    sessionStorage.setItem('fuellog.auth.refresh_token.v1', 'motion-refresh');
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/auth/refresh')) body = {
      access_token: 'motion-access', refresh_token: 'motion-refresh', token_type: 'Bearer',
      expires_in: 900, access_expires_at: new Date(Date.now() + 900000).toISOString(),
      refresh_expires_at: new Date(Date.now() + 86400000).toISOString(), session_id: 'motion-session',
    };
    else if (path.endsWith('/auth/login')) body = {
      mfaRequired: true, challengeToken: 'motion-challenge',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    };
    else if (path.endsWith('/2fa/setup')) body = {
      secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/FuelLog:test?secret=JBSWY3DPEHPK3PXP',
    };
    else if (path.endsWith('/me/2fa')) body = { enabled: false, recoveryCodesRemaining: 0 };
    else if (path.endsWith('/me')) body = {
      id: 'motion-user', name: 'Motorista teste', email: 'motion@example.test', preferredTimezone: 'America/Sao_Paulo',
    };
    else if (path.endsWith('/fuel-types')) body = ['GASOLINE_REGULAR'];
    else if (path.endsWith('/vehicles')) body = [vehicle];
    else if (path.endsWith(`/fuel-entries/${entry.id}`)) body = entry;
    else if (path.endsWith('/fuel-entries')) body = { items: [entry], totalPages: 1, totalElements: 1, page: 0, size: 20 };
    else if (path.endsWith('/consumption-cycles')) body = { items: [], totalElements: 0 };
    else if (path.endsWith('/summary')) body = { purchaseCount: 1, paidTotal: '50.00', purchasedLiters: '10.000', lastValidCycle: null };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

type Frame = { x: number; y: number; opacity: number; headerX?: number; dockX?: number; routeX: number; shellX: number };
let captureIndex = 0;

async function frames(page: Page, id: string, action: () => Promise<unknown>): Promise<Frame[]> {
  await page.evaluate(id => {
    (window as any).startMotionFrames = () => {
    (window as any).motionFrames = new Promise(resolve => {
      const result: Frame[] = [];
      const start = performance.now();
      const tick = () => {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
        const node = nodes.find(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
        if (node) {
          const style = getComputedStyle(node);
          const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
          const header = document.querySelector('[data-testid="header-avatar-button"]');
          const dock = document.querySelector('[aria-label="Ajustes"]');
          const offset = (id: string) => {
            const element = document.querySelector(`[data-testid="${id}"]`);
            const transform = element && getComputedStyle(element).transform;
            return new DOMMatrixReadOnly(!transform || transform === 'none' ? undefined : transform).m41;
          };
          result.push({ x: matrix.m41, y: matrix.m42, opacity: Number(style.opacity),
            headerX: header?.getBoundingClientRect().x, dockX: dock?.getBoundingClientRect().x,
            routeX: offset('auth-route-transition'), shellX: offset('authenticated-transition') });
        }
        if (performance.now() - start < 450) requestAnimationFrame(tick);
        else resolve(result);
      };
      requestAnimationFrame(tick);
    });
    };
    (window as any).startMotionFrames();
  }, id);
  await action();
  const result = await page.evaluate(() => (window as any).motionFrames) as Frame[];
  const path = test.info().outputPath(`${id}-${++captureIndex}-frames.json`);
  await writeFile(path, JSON.stringify(result));
  await test.info().attach(`${id}-frames`, { path, contentType: 'application/json' });
  return result;
}

const click = (locator: Locator) => locator.evaluate(node => {
  (window as any).startMotionFrames?.();
  (node as HTMLElement).click();
});

function expectSlide(result: Frame[], direction = 1) {
  expect(result.length).toBeGreaterThan(5);
  expect(result.some(frame => direction * frame.x > 1)).toBe(true);
  expect(result.some(frame => Math.abs(frame.x) > 0.1 && Math.abs(frame.x) < 16)).toBe(true);
  expect(result.every(frame => frame.y === 0 && frame.opacity >= 0.91)).toBe(true);
  expect(Math.abs(result.at(-1)!.x)).toBeLessThan(0.01);
  expect(result.at(-1)!.opacity).toBe(1);
}

test.describe('Transições laterais com mocks', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('abas e Segurança entram e voltam; header e dock permanecem fixos', async ({ page }) => {
    await mockApi(page);
    await page.goto('/history');
    await expect(page.getByRole('tab', { name: 'Ajustes', exact: true })).toBeVisible();
    const routeFrames = await frames(page, 'authenticated-transition', () => click(page.getByRole('tab', { name: 'Ajustes', exact: true })));
    expectSlide(routeFrames);
    for (const key of ['headerX', 'dockX'] as const) {
      const values = routeFrames.map(frame => frame[key]).filter(value => value !== undefined);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.1);
    }
    expectSlide(await frames(page, 'screen-transition', () => click(page.getByRole('button', { name: /Segurança, senha/ }))));
    expectSlide(await frames(page, 'screen-transition', () => click(page.getByRole('button', { name: 'Voltar para Ajustes' }))), -1);
    expectSlide(await frames(page, 'authenticated-transition', () => click(page.getByRole('tab', { name: 'Histórico', exact: true }))), -1);
  });

  test('painel de senha preserva nó, valor e foco durante digitação; 2FA troca etapas', async ({ page }) => {
    await mockApi(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: /Segurança, senha/ }).click();
    expectSlide(await frames(page, 'sheet-transition', () => click(page.getByRole('button', { name: 'Trocar senha', exact: true }))));
    const password = page.getByLabel('Senha atual', { exact: true });
    const node = await password.elementHandle();
    const typing = await frames(page, 'sheet-transition', () => password.fill('Draft-123!'));
    expect(typing.every(frame => frame.x === 0)).toBe(true);
    await expect(password).toBeFocused();
    expect(await node!.evaluate(node => (node as HTMLInputElement).value)).toBe('Draft-123!');
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('button', { name: 'Autenticação em duas etapas', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Configurar autenticação em duas etapas' })).toBeVisible();
    expectSlide(await frames(page, 'sheet-transition', () => click(page.getByRole('button', { name: 'Configurar autenticação em duas etapas' }))));
    await page.getByLabel('Sua senha', { exact: true }).fill('Draft-123!');
    expectSlide(await frames(page, 'sheet-transition', () => click(page.getByRole('button', { name: 'Continuar', exact: true }))));
    expectSlide(await frames(page, 'sheet-transition', () => click(page.getByRole('button', { name: 'Cancelar', exact: true }))), -1);
  });

  test('filtros e calendário preservam rascunho e mostram direção por mês', async ({ page }) => {
    await mockApi(page);
    await page.goto('/history');
    await page.getByRole('button', { name: /Período:/ }).click();
    await expect(page.getByRole('button', { name: /Selecionar período. Atual:/ })).toBeVisible();
    await page.getByLabel('Valor pago mínimo', { exact: true }).fill('12,34');
    expectSlide(await frames(page, 'sheet-transition', () => click(page.getByRole('button', { name: /Selecionar período. Atual:/ }))));
    expectSlide(await frames(page, 'calendar-transition', () => click(page.getByRole('button', { name: 'Mês anterior' }))), -1);
    expectSlide(await frames(page, 'calendar-transition', () => click(page.getByRole('button', { name: 'Próximo mês' }))));
    expectSlide(await frames(page, 'sheet-transition', () => click(page.getByRole('button', { name: 'Voltar para filtros' }))), -1);
    await expect(page.getByLabel('Valor pago mínimo', { exact: true })).toHaveValue('12,34');
  });

  test('detalhe e edição entram e voltam sem animar alterações de campos', async ({ page }) => {
    await mockApi(page);
    await page.goto('/history');
    await expect(page.getByRole('button', { name: /^Abastecimento de/ })).toBeVisible();
    expectSlide(await frames(page, 'authenticated-transition', () => page.getByRole('button', { name: /^Abastecimento de/ }).click()));
    await page.getByRole('button', { name: 'Opções do abastecimento' }).click();
    expectSlide(await frames(page, 'fuel-detail-transition', () => click(page.getByRole('menuitem', { name: /Editar/ }))));
    const paid = page.getByLabel('Valor pago', { exact: true });
    const paidNode = await paid.elementHandle();
    const typing = await frames(page, 'fuel-detail-transition', () => paid.fill('61,99'));
    expect(typing.every(frame => frame.x === 0 && frame.opacity === 1)).toBe(true);
    expect(await paidNode!.evaluate(node => (node as HTMLInputElement).value)).toBe('61,99');
    await expect(page.getByRole('button', { name: /Cancelar edição|Cancelar|Voltar/, exact: true }).first()).toBeVisible();
    expectSlide(await frames(page, 'fuel-detail-transition', () => click(page.getByRole('button', { name: /Cancelar edição|Cancelar|Voltar/, exact: true }).first())), -1);
  });

  test('rotas públicas, voltar do navegador, recuperação e desafio 2FA', async ({ page }) => {
    await mockApi(page, false);
    await page.goto('/login');
    expectSlide(await frames(page, 'auth-route-transition', () => click(page.getByRole('button', { name: 'Criar conta', exact: true }))));
    expectSlide(await frames(page, 'auth-route-transition', () => page.goBack()), -1);
    expectSlide(await frames(page, 'sheet-transition', () => click(page.getByRole('button', { name: /Esqueci/ }))));
    await page.getByRole('button', { name: 'Entendi' }).click();
    await page.getByLabel('E-mail', { exact: true }).fill('motion@example.test');
    await page.getByLabel('Senha', { exact: true }).fill('Draft-123!');
    expectSlide(await frames(page, 'screen-transition', () => click(page.getByRole('button', { name: 'Entrar', exact: true }))));
    expectSlide(await frames(page, 'screen-transition', () => click(page.getByRole('button', { name: /Voltar/ }))), -1);
  });

  test('veículos, resumo, conta e novo abastecimento usam lateral sem animar campos', async ({ page }) => {
    await mockApi(page);
    await page.goto('/vehicles');
    expectSlide(await frames(page, 'sheet-transition', () => click(page.getByRole('button', { name: 'Editar veículo' }))));
    const model = page.getByTestId('vehicle-model-input');
    await model.fill('Rascunho');
    const modelNode = await model.elementHandle();
    const typing = await frames(page, 'sheet-transition', () => model.fill('Rascunho preservado'));
    expect(typing.every(frame => frame.x === 0 && frame.opacity === 1)).toBe(true);
    expect(await modelNode!.evaluate(node => (node as HTMLInputElement).value)).toBe('Rascunho preservado');
    expectSlide(await frames(page, 'screen-transition', () => click(page.getByRole('button', { name: 'Fechar', exact: true }))), -1);
    expectSlide(await frames(page, 'sheet-transition', () => click(page.getByRole('button', { name: 'Novo veículo', exact: true }))));
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('tab', { name: 'Início', exact: true }).click();
    expectSlide(await frames(page, 'summary-transition', () => click(page.getByRole('button', { name: 'Ver resumo do mês' }))));
    await page.getByRole('button', { name: 'Fechar resumo' }).click();
    expectSlide(await frames(page, 'authenticated-transition', () => click(page.getByTestId('header-avatar-button'))));
    const name = page.getByLabel('Nome completo', { exact: true });
    await name.fill('Rascunho da conta');
    const accountTyping = await frames(page, 'authenticated-transition', () => name.fill('Outro rascunho'));
    expect(accountTyping.every(frame => frame.x === 0)).toBe(true);
    await expect(name).toBeFocused();
    expectSlide(await frames(page, 'authenticated-transition', () => click(page.getByRole('button', { name: 'Voltar', exact: true }))), -1);
    expectSlide(await frames(page, 'authenticated-transition', () => click(page.getByRole('button', { name: 'Novo abastecimento' }))));
    expectSlide(await frames(page, 'authenticated-transition', () => click(page.getByRole('button', { name: 'Fechar', exact: true }))), -1);
  });

  test('login e logout animam a troca de sessão uma vez', async ({ page }) => {
    await mockApi(page, false);
    await page.route('**/api/v1/auth/login', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({
        access_token: 'motion-access', refresh_token: 'motion-refresh', token_type: 'Bearer',
        expires_in: 900, access_expires_at: new Date(Date.now() + 900000).toISOString(),
        refresh_expires_at: new Date(Date.now() + 86400000).toISOString(), session_id: 'motion-session',
      }),
    }));
    await page.goto('/login');
    await page.getByLabel('E-mail', { exact: true }).fill('motion@example.test');
    await page.getByLabel('Senha', { exact: true }).fill('Draft-123!');
    const signedIn = await frames(page, 'session-transition', () => click(page.getByRole('button', { name: 'Entrar', exact: true })));
    expectSlide(signedIn);
    expect(signedIn.every(frame => frame.routeX === 0 && frame.shellX === 0)).toBe(true);
    await expect(page.getByTestId('authenticated-transition')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await page.getByRole('tab', { name: 'Ajustes', exact: true }).click();
    const signedOut = await frames(page, 'session-transition', () => click(page.getByRole('button', { name: 'Sair da conta' })));
    expectSlide(signedOut, -1);
    expect(signedOut.filter(frame => frame.x !== 0).every(frame => frame.routeX === 0 && frame.shellX === 0)).toBe(true);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('auth-route-transition')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  });

  test('interrupção por reduced motion e background deixa conteúdo no lugar e não repete ao retomar', async ({ page }) => {
    await mockApi(page);
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: /Segurança, senha/ })).toBeVisible();
    await click(page.getByRole('button', { name: /Segurança, senha/ }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await frames(page, 'screen-transition', () => click(page.getByRole('button', { name: 'Voltar para Ajustes' })));
    expect(reduced.length).toBeGreaterThan(5);
    expect(reduced.every(frame => frame.x === 0 && frame.opacity === 1)).toBe(true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = await frames(page, 'screen-transition', () => click(page.getByRole('button', { name: /Segurança, senha/ })));
    expect(hidden.length).toBeGreaterThan(5);
    expect(hidden.every(frame => frame.x === 0 && frame.opacity === 1)).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const resumed = await frames(page, 'screen-transition', async () => {});
    expect(resumed.every(frame => frame.x === 0 && frame.opacity === 1)).toBe(true);
    expectSlide(await frames(page, 'screen-transition', async () => {
      await click(page.getByRole('button', { name: 'Voltar para Ajustes' }));
      await click(page.getByRole('button', { name: /Segurança, senha/ }));
    }));
  });
});
