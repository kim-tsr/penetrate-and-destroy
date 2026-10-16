import { defineConfig, devices } from "@playwright/test";

/**
 * e2e en mode mock : `next dev` avec PAD_MOCK=1 (CTFd simulé en mémoire + connexion de test).
 * Le mode mock est refusé en production, d'où `next dev` et non `next start`.
 *
 * Navigateur : par défaut celui de `playwright install chromium` ; pour utiliser un Chromium déjà
 * présent, définir PW_CHROMIUM_PATH (ex. /opt/pw-browsers/chromium-1194/chrome-linux/chrome).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // L'état du CTFd simulé est partagé par le serveur : un seul worker, tests indépendants (pseudos uniques).
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      NODE_ENV: "development",
      PAD_MOCK: "1",
      AUTH_URL: BASE_URL,
      AUTH_SECRET: "e2e-only-secret-e2e-only-secret-0000",
      PAD_SSO_SHARED_SECRET: "e2e-only-sso-secret-e2e-only-0000",
      PAD_MOCK_TOKEN_TTL_S: "900",
      LOG_LEVEL: "warn",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
