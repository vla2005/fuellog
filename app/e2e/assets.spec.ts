import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('login carrega e decodifica mascote e wordmark', async ({ page }) => {
  const responses: { url: string; status: number }[] = [];
  page.on('response', response => {
    if (/mascot|wordmark|\.png/.test(response.url())) responses.push({ url: response.url(), status: response.status() });
  });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  const assets = await page.evaluate(async () => {
    const images = await Promise.all(Array.from(document.images).map(async img => {
      let decodeError: string | null = null;
      try { await img.decode(); } catch (error) { decodeError = String(error); }
      const rect = img.getBoundingClientRect();
      return { src: img.currentSrc || img.src, complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, width: rect.width, height: rect.height, decodeError };
    }));
    const backgrounds = await Promise.all(Array.from(document.querySelectorAll('*')).flatMap(element => {
      const css = getComputedStyle(element);
      const match = css.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (!match) return [];
      return [(async () => {
        const image = new Image();
        image.src = match[1];
        let decodeError: string | null = null;
        try { await image.decode(); } catch (error) { decodeError = String(error); }
        const rect = element.getBoundingClientRect();
        return { src: image.src, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: rect.width, height: rect.height, opacity: css.opacity, visibility: css.visibility, decodeError };
      })()];
    }));
    return { images, backgrounds };
  });
  await mkdir('test-results/qa', { recursive: true });
  await writeFile('test-results/qa/login-assets.json', JSON.stringify({ ...assets, responses }, null, 2));
  await page.screenshot({ path: 'test-results/qa/login-assets-decoded.png', fullPage: true });
  expect(assets.images.every(img => img.complete && img.naturalWidth > 0 && !img.decodeError)).toBe(true);
  expect(assets.backgrounds.every(img => img.naturalWidth > 0 && !img.decodeError)).toBe(true);
});
