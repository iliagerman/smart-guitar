import { defineConfig, devices } from '@playwright/test'

// Dedicated loopback server, synthetic auth/data, no reused browser profiles.
export default defineConfig({
  testDir: './src/e2e/specs',
  testMatch: 'custom-capo.spec.ts',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5187',
    serviceWorkers: 'block',
    launchOptions: { executablePath: process.env.TEST_CHROMIUM_EXECUTABLE },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5187 --strictPort',
    url: 'http://127.0.0.1:5187',
    reuseExistingServer: false,
    env: {
      VITE_API_BASE_URL: 'http://127.0.0.1:5187',
      VITE_COGNITO_USER_POOL_ID: 'us-east-1_test',
      VITE_COGNITO_CLIENT_ID: 'synthetic-client',
      VITE_COGNITO_DOMAIN: 'auth.example.invalid',
      VITE_RUNTIME_OBSERVER_ENABLED: 'false',
    },
  },
})
