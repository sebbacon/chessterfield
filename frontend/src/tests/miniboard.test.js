import { describe, it, expect } from 'vitest'
import { fenToMiniBoard } from '../chess/miniboard.js'

describe('fenToMiniBoard', () => {
  it('returns an 8x8 grid string for starting position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    const html = fenToMiniBoard(fen)
    // Should have 64 cells (light or dark)
    expect((html.match(/class="cell (light|dark)"/g) || []).length).toBe(64)
    // Should have all 32 pieces (16 per side)
    expect((html.match(/class="piece/g) || []).length).toBe(32)
  })

  it('shows white king symbol in starting position', () => {
    const html = fenToMiniBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(html).toContain('♔') // white king
  })

  it('shows black queen symbol in starting position', () => {
    const html = fenToMiniBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(html).toContain('♛') // black queen
  })

  it('handles empty board (only one king)', () => {
    const html = fenToMiniBoard('8/8/8/8/8/8/8/4K3 w - - 0 1')
    expect((html.match(/class="piece/g) || []).length).toBe(1)
  })
})
