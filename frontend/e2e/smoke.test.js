/**
 * Smoke tests against a Playwright-managed Django server.
 * Run: just smoke  (requires: just build first)
 */
import { test, expect } from '@playwright/test'

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const createdPositionIdsByTest = new Map()

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

async function importPosition(page, name, testInfo) {
  await page.click('#go-import')
  await page.fill('#fen-input', FEN)
  await page.fill('#name-input', name)
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/positions/') && response.request().method() === 'POST'
  )
  await page.locator('[type=submit]').click()
  const response = await responsePromise
  const data = await response.json()
  const id = Number.parseInt(data.id, 10)
  if (Number.isFinite(id)) {
    const ids = createdPositionIdsByTest.get(testInfo.testId) || []
    ids.push(id)
    createdPositionIdsByTest.set(testInfo.testId, ids)
  }
  await expect(page.locator('h1')).toHaveText('Positions')
  return id
}

async function openImportedPosition(page, id) {
  await page.goto(`/?view=play&item=${id}`)
}

function smokeName(base, testInfo) {
  return `${base} ${testInfo.testId.slice(-6)}`
}

test('library page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('Positions')
})

test.afterEach(async ({ request }, testInfo) => {
  const ids = createdPositionIdsByTest.get(testInfo.testId) || []
  createdPositionIdsByTest.delete(testInfo.testId)
  await request.get('/')
  const storageState = await request.storageState()
  const csrfToken = storageState.cookies.find(cookie => cookie.name === 'csrftoken')?.value
  for (const id of ids) {
    await request.delete(`/api/positions/${id}/`, {
      failOnStatusCode: false,
      headers: csrfToken ? { 'X-CSRFToken': csrfToken } : {},
    })
  }
})

test('can import a position', async ({ page }, testInfo) => {
  const positionName = smokeName('Smoke Test Position', testInfo)
  await page.goto('/')
  const id = await importPosition(page, positionName, testInfo)
  await openImportedPosition(page, id)
  await expect(page.locator('.pos-info h2')).toHaveText(positionName)
})

test('engine loads, board becomes interactive, and responds to a move', async ({ page }, testInfo) => {
  const consoleMessages = []
  page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', err => consoleMessages.push(`[pageerror] ${err.message}`))
  // Setup: import a position
  const positionName = smokeName('Engine Smoke Test', testInfo)
  await page.goto('/')
  const id = await importPosition(page, positionName, testInfo)
  await openImportedPosition(page, id)

  // Board must be visible
  await expect(page.locator('#board')).toBeVisible()

  // Wait until board is interactive: click e2 and watch for move-dest squares to appear.
  // Board starts disabled until engine posts 'ready' (WASM can take several seconds).
  await expect(async () => {
    await clickSquare(page, 'e2')
    await expect(page.locator('cg-board square.move-dest').first()).toBeVisible({ timeout: 1000 })
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

test('responsive layouts stay usable on desktop and mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(page.locator('#go-import')).toBeVisible()
  await expect(page.locator('#library-nav-toggle')).toBeHidden()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()

  const navToggle = page.locator('#library-nav-toggle')
  await expect(navToggle).toBeVisible()
  await expect(navToggle).toHaveAttribute('aria-expanded', 'false')
  await navToggle.click()
  await expect(navToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#library-sidebar')).toHaveClass(/mobile-open/)
  await page.click('#library-nav-close')
  await expect(navToggle).toHaveAttribute('aria-expanded', 'false')

  const positionName = smokeName('Mobile Layout Smoke', testInfo)
  const id = await importPosition(page, positionName, testInfo)

  const cards = await page.locator('.position-card').evaluateAll(nodes => nodes.slice(0, 2).map(node => {
    const rect = node.getBoundingClientRect()
    return { x: rect.x, y: rect.y }
  }))
  if (cards.length === 2) {
    expect(Math.abs(cards[0].x - cards[1].x)).toBeLessThan(4)
    expect(cards[1].y).toBeGreaterThan(cards[0].y)
  }

  await openImportedPosition(page, id)
  await expect(page.locator('#board')).toBeVisible()
  await expect(page.locator('.move-nav')).toBeVisible()

  const boardBox = await page.locator('#board-wrap').boundingBox()
  const moveNavBox = await page.locator('.move-nav').boundingBox()
  const detailsBox = await page.locator('.play-sidebar-left').boundingBox()
  expect(boardBox).not.toBeNull()
  expect(moveNavBox).not.toBeNull()
  expect(detailsBox).not.toBeNull()
  expect(moveNavBox.y).toBeGreaterThan(boardBox.y + boardBox.height - 4)
  expect(detailsBox.y).toBeGreaterThan(moveNavBox.y)
})
