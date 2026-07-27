const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3459',
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  },
  webServer: null,
});
