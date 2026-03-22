import { describe, it, expect } from 'vitest'
import { parseStockfishLine, cpToPercent } from '../chess/eval.js'

describe('parseStockfishLine', () => {
  it('parses centipawn score', () => {
    const line = 'info depth 20 seldepth 25 multipv 1 score cp 45 nodes 123456 time 500 pv e2e4'
    expect(parseStockfishLine(line)).toEqual({
      cp: 45,
      mate: null,
      depth: 20,
      multipv: 1,
      pv: ['e2e4'],
    })
  })

  it('parses negative centipawn score', () => {
    const line = 'info depth 15 score cp -130 nodes 1000 time 200 pv d7d5'
    expect(parseStockfishLine(line)).toEqual({
      cp: -130,
      mate: null,
      depth: 15,
      multipv: 1,
      pv: ['d7d5'],
    })
  })

  it('parses mate score for White', () => {
    const line = 'info depth 5 score mate 3 nodes 500 time 50 pv e2e4'
    expect(parseStockfishLine(line)).toEqual({
      cp: null,
      mate: 3,
      depth: 5,
      multipv: 1,
      pv: ['e2e4'],
    })
  })

  it('parses mate score for Black', () => {
    const line = 'info depth 5 score mate -2 nodes 500 time 50 pv d7d5'
    expect(parseStockfishLine(line)).toEqual({
      cp: null,
      mate: -2,
      depth: 5,
      multipv: 1,
      pv: ['d7d5'],
    })
  })

  it('parses multipv alternatives with full pv moves', () => {
    const line = 'info depth 18 seldepth 24 multipv 3 score cp 21 nodes 5000 time 100 pv g1f3 d7d5 d2d4'
    expect(parseStockfishLine(line)).toEqual({
      cp: 21,
      mate: null,
      depth: 18,
      multipv: 3,
      pv: ['g1f3', 'd7d5', 'd2d4'],
    })
  })

  it('returns null for non-info lines', () => {
    expect(parseStockfishLine('bestmove e2e4')).toBeNull()
    expect(parseStockfishLine('uciok')).toBeNull()
  })

  it('returns null for info lines without score', () => {
    expect(parseStockfishLine('info depth 1 nodes 100')).toBeNull()
  })

  it('returns null for lowerbound/upperbound aspiration window lines', () => {
    expect(parseStockfishLine('info depth 15 score cp 45 lowerbound nodes 1000')).toBeNull()
    expect(parseStockfishLine('info depth 15 score cp 45 upperbound nodes 1000')).toBeNull()
  })
})

describe('cpToPercent', () => {
  it('maps 0 cp to 50%', () => expect(cpToPercent(0)).toBe(50))
  it('maps +1000 cp to 100%', () => expect(cpToPercent(1000)).toBe(100))
  it('maps -1000 cp to 0%', () => expect(cpToPercent(-1000)).toBe(0))
  it('clamps above +1000', () => expect(cpToPercent(2000)).toBe(100))
  it('clamps below -1000', () => expect(cpToPercent(-2000)).toBe(0))
  it('maps +500 cp to 75%', () => expect(cpToPercent(500)).toBe(75))
  it('maps -500 cp to 25%', () => expect(cpToPercent(-500)).toBe(25))
})
