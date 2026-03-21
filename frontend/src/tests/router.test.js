import { describe, expect, it } from 'vitest'

import { buildUrlFromState, DEFAULT_STATE, mergeState, parseUrlState } from '../router.js'


describe('router state', () => {
  it('parses a game ply URL', () => {
    const state = parseUrlState('?view=play&item=game%3A12&ply=5')
    expect(state.view).toBe('play')
    expect(state.itemId).toBe('game:12')
    expect(state.play.ply).toBe(5)
  })

  it('builds a library URL with filters', () => {
    const state = mergeState(DEFAULT_STATE, {
      library: {
        mode: 'positions',
        page: 3,
        tags: ['endgame', 'lichess'],
      },
    })

    expect(buildUrlFromState(state)).toBe('/?page=3&tags=endgame%2Clichess')
  })

  it('builds a bookmarked play URL for a saved position', () => {
    const state = mergeState(DEFAULT_STATE, {
      view: 'play',
      itemId: 9,
      play: {
        ply: 0,
        side: 'black',
      },
    })

    expect(buildUrlFromState(state)).toBe('/?view=play&item=9&ply=0&side=black')
  })
})
