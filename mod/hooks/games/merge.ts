// 2048-style merge puzzle (named "merge" in the UI to stay clear of trademarks).
import type { Dir, Rng } from './snake'

export type Board = number[][] // 0 = empty

export type Merge = { board: Board; score: number; isOver: boolean; hasWon: boolean }

const SIZE = 4

export function newMerge(rng: Rng): Merge {
  const empty: Board = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 0))
  return { board: addTile(addTile(empty, rng), rng), score: 0, isOver: false, hasWon: false }
}

export function addTile(board: Board, rng: Rng): Board {
  const free: Array<[number, number]> = []
  board.forEach((row, y) => row.forEach((value, x) => value === 0 && free.push([y, x])))
  if (free.length === 0) return board
  const [y, x] = free[Math.floor(rng() * free.length)] ?? free[0]!
  const value = rng() < 0.9 ? 2 : 4
  return board.map((row, ry) => row.map((cell, rx) => (ry === y && rx === x ? value : cell)))
}

// Slides one row toward index 0, merging each pair once.
export function slideRow(row: number[]): { row: number[]; gained: number } {
  const tiles = row.filter(value => value !== 0)
  const out: number[] = []
  let gained = 0
  for (let i = 0; i < tiles.length; i++) {
    const value = tiles[i]!
    if (tiles[i + 1] === value) {
      out.push(value * 2)
      gained += value * 2
      i++
    } else {
      out.push(value)
    }
  }
  while (out.length < row.length) out.push(0)
  return { row: out, gained }
}

function transpose(board: Board): Board {
  return board[0]!.map((_, x) => board.map(row => row[x]!))
}

export function slide(board: Board, dir: Dir): { board: Board; gained: number; isMoved: boolean } {
  const isVertical = dir === 'up' || dir === 'down'
  const isReversed = dir === 'right' || dir === 'down'
  let rows = isVertical ? transpose(board) : board.map(row => [...row])
  let gained = 0
  rows = rows.map(row => {
    const source = isReversed ? [...row].reverse() : row
    const slid = slideRow(source)
    gained += slid.gained
    return isReversed ? slid.row.reverse() : slid.row
  })
  const next = isVertical ? transpose(rows) : rows
  const isMoved = next.some((row, y) => row.some((value, x) => value !== board[y]![x]))
  return { board: next, gained, isMoved }
}

export function canMove(board: Board): boolean {
  return (['up', 'down', 'left', 'right'] as const).some(dir => slide(board, dir).isMoved)
}

export function move(game: Merge, dir: Dir, rng: Rng): Merge {
  if (game.isOver) return game
  const slid = slide(game.board, dir)
  if (!slid.isMoved) return game
  const board = addTile(slid.board, rng)
  return {
    board,
    score: game.score + slid.gained,
    isOver: !canMove(board),
    hasWon: game.hasWon || board.some(row => row.some(value => value >= 2048)),
  }
}

export function drawMerge(game: Merge): string[] {
  const line = '+------+------+------+------+'
  const rows = [line]
  for (const row of game.board) {
    rows.push('|' + row.map(value => (value === 0 ? '' : String(value)).padStart(5, ' ') + ' ').join('|') + '|')
    rows.push(line)
  }
  return rows
}
