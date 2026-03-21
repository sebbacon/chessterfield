import { defineConfig } from '@playwright/test'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = process.env.PLAYWRIGHT_PORT || '18999'
const BASE_URL = `http://localhost:${PORT}`
const browserName = process.env.PLAYWRIGHT_BROWSER || 'chromium'
const channel = process.env.PLAYWRIGHT_CHANNEL
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
const launchOptions = {
  headless: process.env.PLAYWRIGHT_HEADLESS === 'false' ? false : true,
}

if (executablePath) launchOptions.executablePath = executablePath

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  webServer: {
    command: `DJANGO_VITE_DEV_MODE=false ${ROOT}/.venv/bin/python ${ROOT}/manage.py runserver ${PORT} --noreload`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 15_000,
    env: { DJANGO_VITE_DEV_MODE: 'false' },
  },
  use: {
    baseURL: BASE_URL,
    browserName,
    ...(channel ? { channel } : {}),
    launchOptions,
  },
})
