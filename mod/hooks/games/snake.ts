export type Rng = () => number
export type Dir = 'up' | 'down' | 'left' | 'right'
export type Cell = { x: number; y: number }

export type Snake = {
  width: number
  height: number
  body: Cell[] // head first
  dir: Dir
  nextDir: Dir
  food: Cell | null
  score: number
  isOver: boolean
}

const STEP: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

export function newSnake(width: number, height: number, rng: Rng): Snake {
  const y = Math.floor(height / 2)
  const body = [
    { x: 4, y },
    { x: 3, y },
    { x: 2, y },
  ]
  const game: Snake = { width, height, body, dir: 'right', nextDir: 'right', food: null, score: 0, isOver: false }
  return { ...game, food: placeFood(game, rng) }
}

export function turn(game: Snake, dir: Dir): Snake {
  // Reversing into your own neck is ignored rather than fatal.
  if (game.isOver || dir === OPPOSITE[game.dir]) return game
  return { ...game, nextDir: dir }
}

export function tick(game: Snake, rng: Rng): Snake {
  if (game.isOver) return game
  const dir = game.nextDir
  const head = game.body[0]!
  const next = { x: head.x + STEP[dir].x, y: head.y + STEP[dir].y }
  const isWall = next.x < 0 || next.y < 0 || next.x >= game.width || next.y >= game.height
  const isEating = game.food !== null && next.x === game.food.x && next.y === game.food.y
  // The tail moves away this tick unless we grow, so it is not an obstacle.
  const obstacles = isEating ? game.body : game.body.slice(0, -1)
  const isSelf = obstacles.some(cell => cell.x === next.x && cell.y === next.y)
  if (isWall || isSelf) return { ...game, dir, isOver: true }

  const body = [next, ...(isEating ? game.body : game.body.slice(0, -1))]
  const grown = { ...game, body, dir, score: game.score + (isEating ? 1 : 0) }
  return isEating ? { ...grown, food: placeFood(grown, rng) } : grown
}

export function placeFood(game: Snake, rng: Rng): Cell | null {
  const free: Cell[] = []
  for (let y = 0; y < game.height; y++) {
    for (let x = 0; x < game.width; x++) {
      if (!game.body.some(cell => cell.x === x && cell.y === y)) free.push({ x, y })
    }
  }
  if (free.length === 0) return null
  return free[Math.floor(rng() * free.length)] ?? free[0]!
}

export type SnakeGlyphs = { head: string; body: string; food: string; empty: string }

export function drawSnake(game: Snake, glyphs: SnakeGlyphs): string[] {
  const rows: string[][] = []
  for (let y = 0; y < game.height; y++) rows.push(Array.from({ length: game.width }, () => glyphs.empty))
  if (game.food) rows[game.food.y]![game.food.x] = glyphs.food
  game.body.forEach((cell, i) => {
    rows[cell.y]![cell.x] = i === 0 ? glyphs.head : glyphs.body
  })
  return rows.map(row => row.join(''))
}
