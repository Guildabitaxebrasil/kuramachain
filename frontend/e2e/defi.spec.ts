import { test, expect } from '@playwright/test';

const TABS = [
  'Swap',
  'Markets',
  'Pools',
  'Liquidez',
  'Portfólio',
  'Staking',
  'Lending',
  'Bridge',
  'Oráculo',
  'Analytics',
  'Transações',
  'Intelligence',
  'Terminal',
  'Dashboard',
];

/**
 * Smoke test do terminal DeFi.
 *
 * Não depende do nó estar no ar: sem RPC/contratos a UI precisa mostrar
 * “RPC offline” / “Contrato não configurado” em vez de quebrar ou inventar
 * dados. O que se verifica aqui é que nenhuma aba lança erro de runtime.
 */
test.describe('DeFi terminal', () => {
  // O primeiro carregamento em dev compila a árvore de módulos do /defi sob
  // demanda (dezenas de segundos em disco lento); o orçamento cobre isso sem
  // esconder espera de verdade: as trocas de aba custam < 1,5s cada.
  test.describe.configure({ timeout: 120_000 });

  test('carrega /defi e alterna todas as abas sem erro de runtime', async ({ page }) => {
    const crashes: string[] = [];
    page.on('pageerror', (error) => crashes.push(error.message));

    await page.goto('/defi');
    await expect(page.getByRole('heading', { name: /Kurama DeFi/i })).toBeVisible();

    const nav = page.locator('nav[class*="overflow-x-auto"]').first();
    for (const tab of TABS) {
      await nav.getByRole('button', { name: new RegExp(tab, 'i') }).first().click();
      await page.waitForTimeout(120);
    }

    expect(crashes).toEqual([]);
  });

  test('seletor de rede lista KuramaChain e Polygon', async ({ page }) => {
    await page.goto('/defi');
    await page.getByRole('button', { name: /KuramaChain|Ethereum|Polygon/i }).first().click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await expect(page.getByRole('listbox').getByText('Polygon', { exact: true })).toBeVisible();
    await expect(page.getByRole('listbox').getByText('KuramaChain', { exact: true })).toBeVisible();
  });

  test('sem contrato configurado a UI avisa em vez de inventar dados', async ({ page }) => {
    await page.goto('/defi');
    await expect(
      page
        .getByText(/Contrato não configurado|não configurado/i)
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
