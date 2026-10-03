/* @jsx h */
import type { ClientSurface } from 'claude-code'
import type { GameId } from '../../types'
import type { Theme } from '../theme/tokens'
import { drawSnake, newSnake, tick, turn, type Dir, type Snake } from '../games/snake'
import { drawMerge, move, newMerge, type Merge } from '../games/merge'
import { drawMines, flagsLeft, moveCursor, newMines, open, toggleFlag, type Mines } from '../games/mines'

export type ArcadeProps = {
  theme: Theme
  paused: boolean
  reason: 'done' | 'permission' | null
  canSnooze: boolean
  elapsed: string | null
  best: Record<string, number>
}

export type ArcadeMessage =
  | { type: 'best'; game: GameId; score: number; isLowerBetter: boolean }
  | { type: 'back' }
  | { type: 'snooze' }

type Screen = 'menu' | GameId

type State = { screen: Screen; selected: number; snake?: Snake; merge?: Merge; mines?: Mines }

const GAMES: Array<{ id: GameId; label: string; bestLabel: (n: number) => string }> = [
  { id: 'snake', label: '貪食蛇', bestLabel: n => `最高 ${n}` },
  { id: 'merge', label: '合併方塊', bestLabel: n => `最高 ${n}` },
  { id: 'mines', label: '踩地雷', bestLabel: n => `最快 ${n}s` },
]

const SNAKE_TICK_MS = 120

function dirOf(key: string): Dir | null {
  if (key === 'up' || key === 'w' || key === 'k') return 'up'
  if (key === 'down' || key === 's' || key === 'j') return 'down'
  if (key === 'left' || key === 'a' || key === 'h') return 'left'
  if (key === 'right' || key === 'd' || key === 'l') return 'right'
  return null
}

export default function Arcade(props: ArcadeProps, surface: ClientSurface<State>) {
  const { Box, Text } = surface.elements
  const theme = props.theme
  const snakeSize = () => ({
    width: Math.max(8, Math.min(20, Math.floor((surface.columns - 4) / 2))),
    height: Math.max(5, Math.min(12, surface.rows - 7)),
  })

  if (surface.state === undefined) {
    surface.setState({ screen: 'menu', selected: 0 })

    surface.every(SNAKE_TICK_MS, () => {
      const s = surface.state
      if (!s || s.screen !== 'snake' || !s.snake || s.snake.isOver || latest.paused) return
      const snake = tick(s.snake, Math.random)
      if (snake.isOver) surface.post({ type: 'best', game: 'snake', score: snake.score, isLowerBetter: false })
      surface.setState({ ...s, snake })
    })

    surface.onKey(({ key }) => {
      const s = surface.state
      if (!s) return
      if (latest.paused) {
        if (key === 'return') surface.post({ type: 'back' })
        else if (key === 'z' && latest.canSnooze) surface.post({ type: 'snooze' })
        return
      }
      if (s.screen === 'menu') return surface.setState(onMenuKey(s, key))
      if (key === 'q' || key === 'backspace') return surface.setState({ ...s, screen: 'menu' })
      if (s.screen === 'snake') return surface.setState(onSnakeKey(s, key))
      if (s.screen === 'merge') return surface.setState(onMergeKey(s, key))
      return surface.setState(onMinesKey(s, key))
    })
  }
  // Timer and key callbacks read the newest props through this.
  latest = props

  function onMenuKey(s: State, key: string): State {
    const dir = dirOf(key)
    if (dir === 'up') return { ...s, selected: (s.selected + GAMES.length - 1) % GAMES.length }
    if (dir === 'down') return { ...s, selected: (s.selected + 1) % GAMES.length }
    if (key === 'return' || key === ' ' || key === 'space') return { ...s, screen: GAMES[s.selected]!.id }
    return s
  }

  function onSnakeKey(s: State, key: string): State {
    const dir = dirOf(key)
    if (!s.snake || s.snake.isOver || key === 'r') {
      if (!dir && key !== 'r') return s
      const { width, height } = snakeSize()
      const fresh = newSnake(width, height, Math.random)
      return { ...s, snake: dir ? turn(fresh, dir) : fresh }
    }
    return dir ? { ...s, snake: turn(s.snake, dir) } : s
  }

  function onMergeKey(s: State, key: string): State {
    if (!s.merge || key === 'r') return { ...s, merge: newMerge(Math.random) }
    const dir = dirOf(key)
    if (!dir) return s
    const merge = move(s.merge, dir, Math.random)
    if (merge.score > (latest.best.merge ?? 0) && merge.score !== s.merge.score) {
      surface.post({ type: 'best', game: 'merge', score: merge.score, isLowerBetter: false })
    }
    return { ...s, merge }
  }

  function onMinesKey(s: State, key: string): State {
    if (!s.mines || key === 'r') return { ...s, mines: newMines() }
    const dir = dirOf(key)
    if (dir) return { ...s, mines: moveCursor(s.mines, dir) }
    const { x, y } = s.mines.cursor
    if (key === 'f') return { ...s, mines: toggleFlag(s.mines, x, y) }
    if (key === 'return' || key === ' ' || key === 'space') {
      const mines = open(s.mines, x, y, Math.random, Date.now())
      if (mines.hasWon && !s.mines.hasWon && mines.startedAt !== null && mines.finishedAt !== null) {
        const seconds = Math.max(1, Math.round((mines.finishedAt - mines.startedAt) / 1000))
        surface.post({ type: 'best', game: 'mines', score: seconds, isLowerBetter: true })
      }
      return { ...s, mines }
    }
    return s
  }

  const s = surface.state ?? { screen: 'menu', selected: 0 }

  const line = (text: string, color = theme.ink) => (
    <Text color={color} backgroundColor={theme.surface}>
      {text}
    </Text>
  )

  function pauseCard() {
    const isPermission = props.reason === 'permission'
    const title = isPermission ? theme.permissionTitle : theme.doneTitle
    const color = isPermission ? theme.danger : theme.attention
    return (
      <Box flexDirection="column" borderStyle={theme.border} borderColor={color} paddingX={1}>
        {!isPermission && theme.doneArt.map(row => line(row, color))}
        {line(`${title}${props.elapsed ? ` · ${props.elapsed}` : ''}`, color)}
        {isPermission
          ? line('遊戲已暫停。按 Esc 回到 Claude 的授權選單。', theme.ink)
          : line(props.canSnooze ? 'Enter 回去看結果 · z 再玩 30 秒' : 'Enter 回去看結果 · Esc 回提示框', theme.ink)}
        {line('分數會保留。', theme.muted)}
      </Box>
    )
  }

  function menu() {
    return (
      <Box flexDirection="column">
        {GAMES.map((game, i) => {
          const best = props.best[game.id]
          const isSelected = i === s.selected
          return line(
            `${isSelected ? '▸ ' : '  '}${game.label.padEnd(8, ' ')}${best ? game.bestLabel(best) : ''}`,
            isSelected ? theme.accent : theme.ink,
          )
        })}
        {line('')}
        {line('先點一下這裡，再用 ↑↓ 選、Enter 開始', theme.muted)}
        {line('遊戲中 q 回選單 · Esc 回提示框', theme.muted)}
      </Box>
    )
  }

  function snakeView() {
    const snake = s.snake
    if (!snake) return line('按方向鍵（或 wasd）開始', theme.muted)
    const rows = drawSnake(snake, theme.snake)
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle={theme.border} borderColor={snake.isOver ? theme.danger : theme.edge}>
          {rows.map(row => line(row, theme.accent))}
        </Box>
        {line(snake.isOver ? `撞到了！分數 ${snake.score} · r 再來` : `分數 ${snake.score} · 最高 ${props.best.snake ?? 0}`, theme.muted)}
      </Box>
    )
  }

  function mergeView() {
    const merge = s.merge
    if (!merge) return line('按任一方向鍵開始', theme.muted)
    return (
      <Box flexDirection="column">
        {drawMerge(merge).map(row => line(row, theme.accent))}
        {line(merge.isOver ? `沒步了！分數 ${merge.score} · r 再來` : `分數 ${merge.score} · 最高 ${props.best.merge ?? 0}`, theme.muted)}
      </Box>
    )
  }

  function minesView() {
    const mines = s.mines
    if (!mines) return line('按任一方向鍵開始', theme.muted)
    const cells = drawMines(mines)
    return (
      <Box flexDirection="column">
        {cells.map((row, y) => (
          <Box flexDirection="row">
            {row.map((glyph, x) => {
              const isCursor = mines.cursor.x === x && mines.cursor.y === y
              return (
                <Text
                  color={isCursor ? theme.surface : glyph === '*' ? theme.danger : theme.ink}
                  backgroundColor={isCursor ? theme.accent : theme.surface}
                >
                  {` ${glyph}`}
                </Text>
              )
            })}
          </Box>
        ))}
        {line(
          mines.hasWon ? '全部找到了！r 再來' : mines.isOver ? '踩到了！r 再來' : `剩 ${flagsLeft(mines)} 面旗 · Enter 翻開 · f 插旗`,
          theme.muted,
        )}
      </Box>
    )
  }

  const body = s.screen === 'menu' ? menu() : s.screen === 'snake' ? snakeView() : s.screen === 'merge' ? mergeView() : minesView()

  return (
    <Box flexDirection="column" backgroundColor={theme.surface} paddingX={1}>
      {props.paused ? pauseCard() : body}
    </Box>
  )
}

// Module-level so timers and key handlers see the props of the latest draw.
let latest: ArcadeProps = {
  theme: undefined as unknown as Theme,
  paused: false,
  reason: null,
  canSnooze: false,
  elapsed: null,
  best: {},
}
