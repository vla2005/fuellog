import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

for (const width of [390, 320]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const route of ['login', 'register']) {
      test(`${route} ${colorScheme} ${width}px sem clipping horizontal`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme });
        await page.goto(`/${route}`);
        await expect(page.getByRole('button', { name: route === 'login' ? 'Entrar' : 'Criar conta', exact: true })).toBeVisible();
        const layout = await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images).map(image => image.decode()));
          await Promise.all(Array.from(document.querySelectorAll('*')).flatMap(element => {
            const match = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
            if (!match) return [];
            const image = new Image();
            image.src = match[1];
            return [image.decode()];
          }));
          return {
            viewport: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            controls: Array.from(document.querySelectorAll('input, [role="button"]')).map(element => {
              const rect = element.getBoundingClientRect();
              return { label: element.getAttribute('aria-label') || element.textContent, left: rect.left, right: rect.right, width: rect.width };
            }),
          };
        });
        await mkdir('test-results/qa', { recursive: true });
        const name = `${route}-${colorScheme}-${width}x844`;
        await page.screenshot({ path: `test-results/qa/${name}.png`, fullPage: true });
        await writeFile(`test-results/qa/${name}-layout.json`, JSON.stringify(layout, null, 2));
        expect(layout.documentWidth).toBeLessThanOrEqual(width);
        expect(layout.controls.filter(control => control.width > 0 && (control.left < 0 || control.right > width))).toEqual([]);
      });
    }
  }
}
