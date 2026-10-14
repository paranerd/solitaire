import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', timeout: 45000, fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4173/solitaire/', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }, { name: 'firefox', use: { browserName: 'firefox' } }],
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4173/solitaire/', reuseExistingServer: !process.env.CI },
});
