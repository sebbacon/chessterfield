/**
 * Smoke tests against a live Django server (port 8001).
 * Run: just smoke  (requires: just build first)
 */
import { test, expect } from '@playwright/test'

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

// Click a square on the Chessground board (white orientation assumed)
async function clickSquare(page, square) {
  const board = page.locator('cg-board')
  const box = await board.boundingBox()
  const sq = box.width / 8
  const file = square.charCodeAt(0) - 97   // a=0 … h=7
  const rank = parseInt(square[1]) - 1      // 1=0 … 8=7
  await page.mouse.click(
    box.x + (file + 0.5) * sq,
    box.y + (7 - rank + 0.5) * sq,
  )
}

test('library page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('Positions')
})

test('can import a position', async ({ page }) => {
  await page.goto('/')
  await page.click('#go-import')
  await page.fill('#fen-input', FEN)
  await page.fill('#name-input', 'Smoke Test Position')
  await page.locator('[type=submit]').click()
  await expect(page.locator('.position-card h3').filter({ hasText: 'Smoke Test Position' }).first()).toBeVisible()
})

test('engine loads, board becomes interactive, and responds to a move', async ({ page }) => {
  const consoleMessages = []
  page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', err => consoleMessages.push(`[pageerror] ${err.message}`))
  // Setup: import a position
  await page.goto('/')
  await page.click('#go-import')
  await page.fill('#fen-input', FEN)
  await page.fill('#name-input', 'Engine Smoke Test')
  await page.locator('[type=submit]').click()
  await page.locator('.play-btn').first().click()

  // Board must be visible
  await expect(page.locator('#board')).toBeVisible()

  // Wait until board is interactive: click e2 and watch for move-dest squares to appear.
  // Board starts disabled until engine posts 'ready' (WASM can take several seconds).
  await expect(async () => {
    await clickSquare(page, 'e2')
    await expect(page.locator('cg-board square.move-dest')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 30_000 }).catch(err => {
    console.log('Console messages at failure:\n' + consoleMessages.join('\n'))
    throw err
  })

  // Complete the move: e2–e4
  await clickSquare(page, 'e4')

  // Player's move should appear in the history
  await expect(page.locator('#move-history li')).toHaveCount(1)
  await expect(page.locator('#move-history li').first()).toContainText('e4')

  // Engine must respond: the first list item should gain a second move (or a new item appears)
  // We wait for the move history to show the engine's reply (depth 20 may take a moment)
  await expect(async () => {
    const text = await page.locator('#move-history li').first().textContent()
    expect(text.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2)
  }).toPass({ timeout: 30_000 })

  // Eval bar must have updated from its initial 50%
  const height = await page.locator('#eval-fill').evaluate(el => el.style.height)
  expect(height).not.toBe('50%')
})
