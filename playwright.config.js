const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  webServer: {
    command: 'node tests/e2e/server.mjs 3456',
    url: 'http://localhost:3456',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3456',
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  },
});
