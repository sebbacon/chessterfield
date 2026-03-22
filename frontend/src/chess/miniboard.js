const PIECE_NAMES = {
  p: 'pawn',
  r: 'rook',
  n: 'knight',
  b: 'bishop',
  q: 'queen',
  k: 'king',
}

/**
 * Convert FEN position string to a minimal 8×8 HTML grid string.
 * Returns an HTML string suitable for innerHTML.
 */
export function fenToMiniBoard(fen) {
  const positionPart = fen.split(' ')[0]
  const rows = positionPart.split('/')

  let html = '<div class="miniboard cg-wrap">'
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
        const role = PIECE_NAMES[ch.toLowerCase()] ?? ''
        const color = ch === ch.toUpperCase() ? 'white' : 'black'
        html += `<span class="cell ${shade}"></span>`
        if (role) {
          html += `<piece class="${role} ${color}" style="transform: translate(${fileIdx * 100}%, ${rankIdx * 100}%);"></piece>`
        }
        fileIdx++
      }
    }
  })
  html += '</div>'
  return html
}
