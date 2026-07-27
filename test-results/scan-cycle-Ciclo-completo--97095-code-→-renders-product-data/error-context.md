# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scan-cycle.spec.js >> Ciclo completo de escaneo >> 1. Submit manual barcode → renders product data
- Location: tests\e2e\scan-cycle.spec.js:82:3

# Error details

```
Error: page.goto: Target page, context or browser has been closed
```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | 
  3   | const VALID_BARCODE = '7501234567893';
  4   | const NOTFOUND_BARCODE = '7500000000008';
  5   | const NONFOOD_BARCODE = '7509999999997';
  6   | const INVALID_CHECKSUM = '7501234567890';
  7   | 
  8   | const MOCK_PRODUCT = {
  9   |   status: 1,
  10  |   product: {
  11  |     _id: VALID_BARCODE, code: VALID_BARCODE,
  12  |     product_name: 'Galletas de Prueba',
  13  |     brands: 'Marca Test',
  14  |     image_front_url: 'https://images.openfoodfacts.org/images/products/750/123/456/7893/front_es.jpg',
  15  |     categories: 'galletas',
  16  |     categories_tags: ['es:galletas'],
  17  |     isFood: true,
  18  |     ingredients_text: 'Harina de trigo, azúcar, aceite vegetal, sal',
  19  |     ingredients: [{ id: 'en:flour', text: 'Harina de trigo' }],
  20  |     nutriments: { 'energy-kcal_100g': 450, 'fat_100g': 18, 'saturated-fat_100g': 5, 'carbohydrates_100g': 65, 'sugars_100g': 25, 'fiber_100g': 2, 'proteins_100g': 6, 'salt_100g': 0.8, 'sodium_100g': 0.32 },
  21  |     nutriscore_grade: 'c',
  22  |     allergens_tags: ['en:gluten', 'en:milk'],
  23  |     allergens_from_ingredients: 'Contiene gluten, leche',
  24  |     labels_tags: ['en:vegan', 'en:keto'],
  25  |     dietary: { vegan: true, vegetarian: null, keto: true, kosher: null, halal: null, organic: null, nonGmo: null, noAdditives: null, palmOilFree: null, fairTrade: null, caseinFree: null },
  26  |     sellos: [],
  27  |     gluten: { hasGluten: true, classification: 'declared', source: 'db' },
  28  |   },
  29  |   source: 'off', sourceLabel: 'Open Food Facts',
  30  | };
  31  | 
  32  | const MOCK_NONFOOD = {
  33  |   status: 1,
  34  |   product: {
  35  |     _id: NONFOOD_BARCODE, code: NONFOOD_BARCODE,
  36  |     product_name: 'Shampoo Test',
  37  |     brands: 'Marca Test',
  38  |     categories: 'higiene',
  39  |     categories_tags: ['es:higiene'],
  40  |     isFood: false,
  41  |     ingredients_text: null,
  42  |     nutriments: {},
  43  |   },
  44  |   source: 'off', sourceLabel: 'Open Food Facts',
  45  | };
  46  | 
  47  | test.describe('Ciclo completo de escaneo', () => {
  48  | 
  49  |   test.beforeEach(async ({ page }) => {
  50  |     await page.addInitScript(() => {
  51  |       localStorage.setItem('yomi_disclaimer_accepted', '1');
  52  |     });
  53  |     await page.route('**/api/product/**', async route => {
  54  |       const url = route.request().url();
  55  |       if (url.includes(VALID_BARCODE))
  56  |         await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PRODUCT) });
  57  |       else if (url.includes(NONFOOD_BARCODE))
  58  |         await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_NONFOOD) });
  59  |       else
  60  |         await route.fulfill({ status: 404, body: 'Not Found' });
  61  |     });
  62  |     await page.route('**/api/ai-query*', async route => {
  63  |       await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: '{}', model: 'test' }) });
  64  |     });
  65  |     await page.goto('/scan.html');
  66  |     await page.waitForLoadState('networkidle');
  67  |   });
  68  | 
  69  |   test('1. Product found → renders data', async ({ page }) => {
  70  |     await page.locator('#barcode-input').fill(VALID_BARCODE);
  71  |     await page.locator('#barcode-form button[type="submit"]').click();
  72  |     await expect(page.locator('#result-success')).toHaveClass(/active/);
  73  |     await expect(page.locator('#product-name')).toContainText('Galletas de Prueba');
  74  |     await expect(page.locator('#product-brand')).toContainText('Marca Test');
  75  |     await expect(page.locator('#verdict-banner')).not.toBeEmpty();
  76  |   });
  77  | 
> 78  |   test('2. Not found → rejected screen', async ({ page }) => {
      |                ^ Error: page.goto: Target page, context or browser has been closed
  79  |     await page.locator('#barcode-input').fill(NOTFOUND_BARCODE);
  80  |     await page.locator('#barcode-form button[type="submit"]').click();
  81  |     await expect(page.locator('#result-rejected')).toHaveClass(/active/);
  82  |     await expect(page.locator('#rejected-title')).toContainText('No Encontrado');
  83  |   });
  84  | 
  85  |   test('3. Non-food → rejected screen', async ({ page }) => {
  86  |     await page.locator('#barcode-input').fill(NONFOOD_BARCODE);
  87  |     await page.locator('#barcode-form button[type="submit"]').click();
  88  |     await expect(page.locator('#result-rejected')).toHaveClass(/active/);
  89  |     await expect(page.locator('#rejected-title')).toContainText('Producto Rechazado');
  90  |   });
  91  | 
  92  |   test('4. Invalid (non-numeric) → error', async ({ page }) => {
  93  |     await page.locator('#barcode-input').fill('ABC123');
  94  |     await page.locator('#barcode-form button[type="submit"]').click();
  95  |     await expect(page.locator('#result-rejected')).toHaveClass(/active/);
  96  |     await expect(page.locator('#rejected-title')).toContainText('Código inválido');
  97  |   });
  98  | 
  99  |   test('5. Invalid checksum → error', async ({ page }) => {
  100 |     await page.locator('#barcode-input').fill(INVALID_CHECKSUM);
  101 |     await page.locator('#barcode-form button[type="submit"]').click();
  102 |     await expect(page.locator('#result-rejected')).toHaveClass(/active/);
  103 |     await expect(page.locator('#rejected-title')).toContainText('Código inválido');
  104 |   });
  105 | 
  106 |   test('6. Mobile: manual input visible after not-found', async ({ page }) => {
  107 |     await page.setViewportSize({ width: 390, height: 844 });
  108 |     await page.locator('#barcode-input').fill(NOTFOUND_BARCODE);
  109 |     await page.locator('#barcode-form button[type="submit"]').click();
  110 |     await expect(page.locator('#result-rejected')).toHaveClass(/active/);
  111 |     await expect(page.locator('#manual-input-section')).toBeVisible();
  112 |   });
  113 | 
  114 |   test('7. Scanner coaching text exists', async ({ page }) => {
  115 |     await expect(page.locator('#scan-coaching')).toBeVisible();
  116 |     await expect(page.locator('#scan-coaching')).toHaveAttribute('aria-live', 'polite');
  117 |   });
  118 | 
  119 |   test('8. Camera toggle button exists', async ({ page }) => {
  120 |     const toggle = page.locator('#btn-toggle-camera');
  121 |     await expect(toggle).toBeVisible();
  122 |     await expect(toggle.locator('text=Activar cámara')).toBeVisible();
  123 |   });
  124 | 
  125 |   test('9. Nav scan reset button exists', async ({ page }) => {
  126 |     await expect(page.locator('#nav-scan-reset')).toBeVisible();
  127 |   });
  128 | 
  129 | });
  130 | 
```