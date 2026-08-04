const { test, expect } = require('@playwright/test');

const VALID_BARCODE = '7501234567893';
const NOTFOUND_BARCODE = '7500000000008';
const NONFOOD_BARCODE = '7509999999997';
const INVALID_CHECKSUM = '7501234567890';

const MOCK_PRODUCT = {
  status: 1,
  product: {
    _id: VALID_BARCODE, code: VALID_BARCODE,
    product_name: 'Galletas de Prueba',
    brands: 'Marca Test',
    image_front_url: 'https://images.openfoodfacts.org/images/products/750/123/456/7893/front_es.jpg',
    categories: 'galletas',
    categories_tags: ['es:galletas'],
    isFood: true,
    ingredients_text: 'Harina de trigo, azúcar, aceite vegetal, sal',
    ingredients: [{ id: 'en:flour', text: 'Harina de trigo' }],
    nutriments: { 'energy-kcal_100g': 450, 'fat_100g': 18, 'saturated-fat_100g': 5, 'carbohydrates_100g': 65, 'sugars_100g': 25, 'fiber_100g': 2, 'proteins_100g': 6, 'salt_100g': 0.8, 'sodium_100g': 0.32 },
    nutriscore_grade: 'c',
    allergens_tags: ['en:gluten', 'en:milk'],
    allergens_from_ingredients: 'Contiene gluten, leche',
    labels_tags: ['en:vegan', 'en:keto'],
    dietary: { vegan: true, vegetarian: null, keto: true, kosher: null, halal: null, organic: null, nonGmo: null, noAdditives: null, palmOilFree: null, fairTrade: null, caseinFree: null },
    sellos: [],
    gluten: { hasGluten: true, classification: 'declared', source: 'db' },
  },
  source: 'off', sourceLabel: 'Open Food Facts',
};

const MOCK_NONFOOD = {
  status: 1,
  product: {
    _id: NONFOOD_BARCODE, code: NONFOOD_BARCODE,
    product_name: 'Shampoo Test',
    brands: 'Marca Test',
    categories: 'higiene',
    categories_tags: ['es:higiene'],
    isFood: false,
    ingredients_text: null,
    nutriments: {},
  },
  source: 'off', sourceLabel: 'Open Food Facts',
};

test.describe('Ciclo completo de escaneo', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('yomi_disclaimer_accepted', '1');
    });
    await page.route('**/api/product/**', async route => {
      const url = route.request().url();
      if (url.includes(VALID_BARCODE))
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PRODUCT) });
      else if (url.includes(NONFOOD_BARCODE))
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_NONFOOD) });
      else
        await route.fulfill({ status: 404, body: 'Not Found' });
    });
    await page.route('**/api/ai-query*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: '{}', model: 'test' }) });
    });
    await page.goto('/scan.html');
    await page.waitForLoadState('networkidle');
  });

  test('1. Product found → renders data', async ({ page }) => {
    await page.locator('#barcode-input').fill(VALID_BARCODE);
    await page.locator('#barcode-form button[type="submit"]').click();
    await expect(page.locator('#result-success')).toHaveClass(/active/);
    await expect(page.locator('#product-name')).toContainText('Galletas de Prueba');
    await expect(page.locator('#product-brand')).toContainText('Marca Test');
    await expect(page.locator('#verdict-banner')).not.toBeEmpty();
  });

  test('dispara el evento "Scan Completado" con el verdict correcto', async ({ page }) => {
    await page.addInitScript(() => {
      window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    });
    await page.locator('#barcode-input').fill(VALID_BARCODE);
    await page.locator('#barcode-form button[type="submit"]').click();
    await expect(page.locator('#result-success')).toHaveClass(/active/);
    const events = await page.evaluate(() => (window.vaq || []).map(args => args[1]));
    const scanEvent = events.find(e => e && e.name === 'Scan Completado');
    expect(scanEvent).toBeTruthy();
    expect(['sano', 'regular', 'evitar']).toContain(scanEvent.data.verdict);
  });

  test('2. Not found → rejected screen', async ({ page }) => {
    await page.locator('#barcode-input').fill(NOTFOUND_BARCODE);
    await page.locator('#barcode-form button[type="submit"]').click();
    await expect(page.locator('#result-rejected')).toHaveClass(/active/);
    await expect(page.locator('#rejected-title')).toContainText('No Encontrado');
  });

  test('3. Non-food → rejected screen', async ({ page }) => {
    await page.locator('#barcode-input').fill(NONFOOD_BARCODE);
    await page.locator('#barcode-form button[type="submit"]').click();
    await expect(page.locator('#result-rejected')).toHaveClass(/active/);
    await expect(page.locator('#rejected-title')).toContainText('Producto Rechazado');
  });

  test('4. Invalid (non-numeric) → error', async ({ page }) => {
    await page.locator('#barcode-input').fill('ABC123');
    await page.locator('#barcode-form button[type="submit"]').click();
    await expect(page.locator('#result-rejected')).toHaveClass(/active/);
    await expect(page.locator('#rejected-title')).toContainText('Código inválido');
  });

  test('5. Invalid checksum → error', async ({ page }) => {
    await page.locator('#barcode-input').fill(INVALID_CHECKSUM);
    await page.locator('#barcode-form button[type="submit"]').click();
    await expect(page.locator('#result-rejected')).toHaveClass(/active/);
    await expect(page.locator('#rejected-title')).toContainText('Código inválido');
  });

  test('6. Mobile: manual input visible after not-found', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#barcode-input').fill(NOTFOUND_BARCODE);
    await page.locator('#barcode-form button[type="submit"]').click();
    await expect(page.locator('#result-rejected')).toHaveClass(/active/);
    await expect(page.locator('#manual-input-section')).toBeVisible();
  });

  test('7. Scanner coaching text exists', async ({ page }) => {
    await expect(page.locator('#scan-coaching')).toBeVisible();
    await expect(page.locator('#scan-coaching')).toHaveAttribute('aria-live', 'polite');
  });

  test('8. Camera toggle button exists', async ({ page }) => {
    const toggle = page.locator('#btn-toggle-camera');
    await expect(toggle).toBeVisible();
    await expect(toggle.locator('text=Activar cámara')).toBeVisible();
  });

  test('9. Nav scan reset button exists', async ({ page }) => {
    await expect(page.locator('#nav-scan-reset')).toBeVisible();
  });

});
