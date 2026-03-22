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
        viewed: 'unviewed',
      },
    })

    expect(buildUrlFromState(state)).toBe('/tags/endgame+lichess/?page=3&viewed=unviewed')
  })

  it('parses a tagged library URL', () => {
    const state = parseUrlState('/tags/endgame+lichess/', '?page=2&viewed=viewed')

    expect(state.view).toBe('library')
    expect(state.library.mode).toBe('positions')
    expect(state.library.page).toBe(2)
    expect(state.library.tags).toEqual(['endgame', 'lichess'])
    expect(state.library.viewed).toBe('viewed')
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
