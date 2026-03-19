const WHITE_PIECES = { P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔' }
const BLACK_PIECES = { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' }
const ALL_PIECES = { ...WHITE_PIECES, ...BLACK_PIECES }

/**
 * Convert FEN position string to a minimal 8×8 HTML grid string.
 * Returns an HTML string suitable for innerHTML.
 */
export function fenToMiniBoard(fen) {
  const positionPart = fen.split(' ')[0]
  const rows = positionPart.split('/')

  let html = '<div class="miniboard">'
  rows.forEach((row, rankIdx) => {
    let fileIdx = 0
    for (const ch of row) {
      if (/\d/.test(ch)) {
        const count = parseInt(ch, 10)
        for (let i = 0; i < count; i++) {
          const shade = (rankIdx + fileIdx) % 2 === 0 ? 'light' : 'dark'
          html += `<span class="cell ${shade}"></span>`
          fileIdx++
        }
      } else {
        const shade = (rankIdx + fileIdx) % 2 === 0 ? 'light' : 'dark'
        const symbol = ALL_PIECES[ch] ?? ''
        const color = ch === ch.toUpperCase() ? 'white' : 'black'
        html += `<span class="cell ${shade}">${symbol ? `<span class="piece ${color}">${symbol}</span>` : ''}</span>`
        fileIdx++
      }
    }
  })
  html += '</div>'
  return html
}
