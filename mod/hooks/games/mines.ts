import type { Dir, Rng } from './snake'

export type MineCell = { isMine: boolean; isOpen: boolean; isFlagged: boolean; around: number }

export type Mines = {
  width: number
  height: number
  mineCount: number
  cells: MineCell[][]
  cursor: { x: number; y: number }
  isLaid: boolean // mines are laid on the first open, so it is never a mine
  isOver: boolean
  hasWon: boolean
  startedAt: number | null
  finishedAt: number | null
}

export function newMines(width = 9, height = 9, mineCount = 10): Mines {
  const cells = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ isMine: false, isOpen: false, isFlagged: false, around: 0 })),
  )
  return {
    width,
    height,
    mineCount,
    cells,
    cursor: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    isLaid: false,
    isOver: false,
    hasWon: false,
    startedAt: null,
    finishedAt: null,
  }
}

function neighbours(game: Mines, x: number, y: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      const ny = y + dy
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < game.width && ny < game.height) out.push([nx, ny])
    }
  }
  return out
}

function clone(game: Mines): Mines {
  return { ...game, cells: game.cells.map(row => row.map(cell => ({ ...cell }))) }
}

// Lays mines anywhere except the first opened cell and its neighbours.
export function layMines(game: Mines, safeX: number, safeY: number, rng: Rng): Mines {
  const next = clone(game)
  const safe = new Set([`${safeX},${safeY}`, ...neighbours(game, safeX, safeY).map(([x, y]) => `${x},${y}`)])
  const spots: Array<[number, number]> = []
  for (let y = 0; y < game.height; y++) {
    for (let x = 0; x < game.width; x++) if (!safe.has(`${x},${y}`)) spots.push([x, y])
  }
  const count = Math.min(game.mineCount, spots.length)
  for (let i = 0; i < count; i++) {
    const pick = i + Math.floor(rng() * (spots.length - i))
    const chosen = spots[pick]!
    spots[pick] = spots[i]!
    spots[i] = chosen
    next.cells[chosen[1]]![chosen[0]]!.isMine = true
  }
  for (let y = 0; y < game.height; y++) {
    for (let x = 0; x < game.width; x++) {
      next.cells[y]![x]!.around = neighbours(next, x, y).filter(([nx, ny]) => next.cells[ny]![nx]!.isMine).length
    }
  }
  return { ...next, isLaid: true }
}

export function open(game: Mines, x: number, y: number, rng: Rng, now: number): Mines {
  if (game.isOver) return game
  let next = game.isLaid ? clone(game) : layMines(game, x, y, rng)
  if (next.startedAt === null) next = { ...next, startedAt: now }
  const first = next.cells[y]![x]!
  if (first.isOpen || first.isFlagged) return next
  if (first.isMine) {
    first.isOpen = true
    return { ...next, isOver: true, finishedAt: now }
  }
  // Flood-fill empty areas.
  const queue: Array<[number, number]> = [[x, y]]
  while (queue.length > 0) {
    const [cx, cy] = queue.pop()!
    const cell = next.cells[cy]![cx]!
    if (cell.isOpen || cell.isFlagged) continue
    cell.isOpen = true
    if (cell.around === 0) queue.push(...neighbours(next, cx, cy))
  }
  const closedSafe = next.cells.flat().filter(cell => !cell.isMine && !cell.isOpen).length
  return closedSafe === 0 ? { ...next, isOver: true, hasWon: true, finishedAt: now } : next
}

export function toggleFlag(game: Mines, x: number, y: number): Mines {
  if (game.isOver || game.cells[y]![x]!.isOpen) return game
  const next = clone(game)
  next.cells[y]![x]!.isFlagged = !next.cells[y]![x]!.isFlagged
  return next
}

export function moveCursor(game: Mines, dir: Dir): Mines {
  const { x, y } = game.cursor
  const cursor = {
    x: Math.min(game.width - 1, Math.max(0, x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0))),
    y: Math.min(game.height - 1, Math.max(0, y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0))),
  }
  return { ...game, cursor }
}

export function flagsLeft(game: Mines): number {
  return game.mineCount - game.cells.flat().filter(cell => cell.isFlagged).length
}

// One string per cell, so the view can colour the cursor separately.
export function drawMines(game: Mines): string[][] {
  return game.cells.map(row =>
    row.map(cell => {
      if (cell.isFlagged && !cell.isOpen) return '⚑'
      if (!cell.isOpen) return game.isOver && cell.isMine ? '*' : '·'
      if (cell.isMine) return '*'
      return cell.around === 0 ? ' ' : String(cell.around)
    }),
  )
}
