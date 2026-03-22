/**
 * Parse a Stockfish UCI output line into { cp, mate, depth, multipv, pv } or null.
 * cp: centipawns (positive = White advantage)
 * mate: moves to mate (positive = White mates, negative = Black mates)
 */
export function parseStockfishLine(line) {
  if (!line.startsWith('info')) return null
  if (line.includes(' lowerbound') || line.includes(' upperbound')) return null

  const depthMatch = line.match(/\bdepth\s+(\d+)/)
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/)
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/)
  const multipvMatch = line.match(/\bmultipv\s+(\d+)/)
  const pvMatch = line.match(/\bpv\s+(.+)$/)

  if (!depthMatch || (!cpMatch && !mateMatch)) return null

  return {
    cp: cpMatch ? parseInt(cpMatch[1], 10) : null,
    mate: mateMatch ? parseInt(mateMatch[1], 10) : null,
    depth: parseInt(depthMatch[1], 10),
    multipv: multipvMatch ? parseInt(multipvMatch[1], 10) : 1,
    pv: pvMatch ? pvMatch[1].trim().split(/\s+/).filter(Boolean) : [],
  }
}

/**
 * Map centipawn score to a 0–100 percentage for the eval bar.
 * 50 = equal, 100 = White winning, 0 = Black winning.
 */
export function cpToPercent(cp) {
  const clamped = Math.max(-1000, Math.min(1000, cp))
  return 50 + (clamped / 1000) * 50
}
