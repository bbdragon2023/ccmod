import { describe, expect, test } from 'claude-code/testing'
import { drawSnake, newSnake, tick, turn, type Snake } from '../hooks/games/snake'
import { canMove, move, newMerge, slideRow, type Merge } from '../hooks/games/merge'
import { drawMines, flagsLeft, moveCursor, newMines, open, toggleFlag } from '../hooks/games/mines'

const zero = () => 0

describe('snake', () => {
  test('moves forward one cell per tick', async () => {
    const game = newSnake(10, 6, zero)
    const next = tick({ ...game, food: { x: 9, y: 0 } }, zero)
    expect(next.body[0]).toEqual({ x: 5, y: 3 })
    expect(next.body.length).toBe(3)
  })

  test('eating grows the body and scores', async () => {
    const game: Snake = { ...newSnake(10, 6, zero), food: { x: 5, y: 3 } }
    const next = tick(game, zero)
    expect(next.score).toBe(1)
    expect(next.body.length).toBe(4)
    expect(next.food).not.toEqual({ x: 5, y: 3 })
  })

  test('hitting a wall ends the round', async () => {
    let game: Snake = { ...newSnake(6, 4, zero), food: { x: 0, y: 0 } }
    for (let i = 0; i < 3; i++) game = tick(game, zero)
    expect(game.isOver).toBe(true)
  })

  test('reversing into the neck is ignored', async () => {
    const game = newSnake(10, 6, zero)
    expect(turn(game, 'left').nextDir).toBe('right')
    expect(turn(game, 'up').nextDir).toBe('up')
  })

  test('draws head, body and food', async () => {
    const game: Snake = { ...newSnake(6, 3, zero), food: { x: 0, y: 0 } }
    const rows = drawSnake(game, { head: 'H', body: 'b', food: 'F', empty: '.' })
    expect(rows).toEqual(['F.....', '..bbH.', '......'])
  })
})

describe('merge', () => {
  test('merges each pair once', async () => {
    expect(slideRow([2, 2, 2, 2])).toEqual({ row: [4, 4, 0, 0], gained: 8 })
    expect(slideRow([2, 0, 2, 4])).toEqual({ row: [4, 4, 0, 0], gained: 4 })
    expect(slideRow([4, 4, 8, 0])).toEqual({ row: [8, 8, 0, 0], gained: 8 })
  })

  test('a move that changes nothing adds no tile', async () => {
    const game: Merge = { board: [[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 0, isOver: false, hasWon: false }
    expect(move(game, 'left', zero)).toBe(game)
    const moved = move(game, 'right', zero)
    expect(moved.board[0]![3]).toBe(2)
    expect(moved.board.flat().filter(v => v > 0).length).toBe(2)
  })

  test('a full board with no pairs is over', async () => {
    const board = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]
    expect(canMove(board)).toBe(false)
  })

  test('starts with two tiles', async () => {
    expect(newMerge(zero).board.flat().filter(v => v > 0).length).toBe(2)
  })
})

describe('mines', () => {
  test('the first open is never a mine and floods open', async () => {
    for (const seed of [0, 0.3, 0.7, 0.99]) {
      const game = open(newMines(9, 9, 10), 4, 4, () => seed, 1_000)
      expect(game.cells[4]![4]!.isMine).toBe(false)
      expect(game.isOver && !game.hasWon).toBe(false)
      expect(game.cells.flat().filter(c => c.isMine).length).toBe(10)
    }
  })

  test('opening a mine ends the round', async () => {
    // A spread-out layout; with rng = 0 the mines cluster and the first open wins outright.
    let seed = 42
    const lcg = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    let game = open(newMines(9, 9, 10), 0, 0, lcg, 1_000)
    expect(game.isOver).toBe(false)
    const mineY = game.cells.findIndex(row => row.some(c => c.isMine))
    const mineX = game.cells[mineY]!.findIndex(c => c.isMine)
    game = open(game, mineX, mineY, zero, 2_000)
    expect(game.isOver).toBe(true)
    expect(game.hasWon).toBe(false)
  })

  test('opening every safe cell wins', async () => {
    let game = open(newMines(5, 5, 1), 0, 0, zero, 1_000)
    game.cells.forEach((row, y) =>
      row.forEach((cell, x) => {
        if (!cell.isMine) game = open(game, x, y, zero, 3_000)
      }),
    )
    expect(game.hasWon).toBe(true)
    expect(game.finishedAt).toBe(game.isOver ? game.finishedAt : null)
  })

  test('flags count down and a flagged cell will not open', async () => {
    let game = toggleFlag(newMines(), 1, 1)
    expect(flagsLeft(game)).toBe(9)
    game = open(game, 1, 1, zero, 1_000)
    expect(game.cells[1]![1]!.isOpen).toBe(false)
    expect(drawMines(game)[1]![1]).toBe('⚑')
  })

  test('the cursor stays on the board', async () => {
    let game = newMines(3, 3, 1)
    for (let i = 0; i < 5; i++) game = moveCursor(game, 'left')
    expect(game.cursor).toEqual({ x: 0, y: 1 })
  })
})
