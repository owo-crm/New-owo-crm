import { defineConfig, devices } from "@playwright/test";

/**
 * Сквозные тесты (браузер). Запуск: npm run test:e2e
 * Нужна ОТДЕЛЬНАЯ тестовая база в DATABASE_URL: global-setup её полностью очищает.
 * PW_CHROMIUM_PATH — путь к уже установленному Chromium (если `npx playwright install` недоступен).
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1,
  outputDir: "test-results",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3200",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "npm run build && npx next start -p 3200",
    url: "http://localhost:3200/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      INTAKE_IP_SALT: "e2e-salt",
      NOTIFICATION_WORKER: "off",
      REGISTRATION_OPEN: "true",
      DEFAULT_DOCUMENT_ENGINE: "barowo",
    },
  },
});
