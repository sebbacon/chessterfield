import { defineConfig } from '@playwright/test'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '..')

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  webServer: {
    command: `DJANGO_VITE_DEV_MODE=false ${ROOT}/.venv/bin/python ${ROOT}/manage.py runserver 18999 --noreload`,
    url: 'http://localhost:18999',
    reuseExistingServer: false,
    timeout: 15_000,
    env: { DJANGO_VITE_DEV_MODE: 'false' },
  },
  use: {
    baseURL: 'http://localhost:18999',
    browserName: 'chromium',
    launchOptions: {
      headless: true,
      executablePath: `${ROOT}/.playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    },
  },
})
