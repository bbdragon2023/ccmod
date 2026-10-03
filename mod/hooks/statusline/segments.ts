// Mirrors the user's statusline-cost.sh segments; the mod's status line is plain text.
export type Segment = 'dir' | 'bun' | 'branch' | 'model' | 'cost' | 'daily' | 'limit' | 'chatchat'

export const SEGMENTS: Segment[] = ['dir', 'bun', 'branch', 'model', 'cost', 'daily', 'limit', 'chatchat']

export type StatusMode = 'auto' | 'full' | 'off'

export type StatusOptions = { mode: StatusMode; segments: Record<Segment, boolean> }

export const DEFAULT_OPTIONS: StatusOptions = {
  mode: 'auto',
  segments: { dir: true, bun: false, branch: true, model: true, cost: true, daily: true, limit: true, chatchat: true },
}

export type StatusData = {
  now: number
  hasOwnStatusLine: boolean
  dir?: string
  bun?: string
  branch?: string
  isDirty?: boolean
  model?: string
  costUsd?: number
  dailyUsd?: number
  fiveHour?: { percentUsed: number; resetsAt?: string }
  chatchat?: string
}

const SEP = ' | '

export function money(usd: number): string {
  return `$${usd.toFixed(2)}`
}

export function timeLeft(resetsAt: string | undefined, now: number): string | undefined {
  if (!resetsAt) return undefined
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return undefined
  const remain = Math.max(0, Math.floor((at - now) / 1000))
  return `${Math.floor(remain / 3600)}h ${Math.floor((remain % 3600) / 60)}m left`
}

// Colour is unavailable in the plugin status line, so severity becomes a marker.
export function limitMarker(percentUsed: number): string {
  if (percentUsed >= 90) return '🔴 '
  if (percentUsed >= 70) return '⚠ '
  return ''
}

export function prettyModel(id: string): string {
  const match = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(id)
  if (!match) return id
  const family = match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1).toLowerCase()
  const minor = match[3] && match[3].length <= 2 ? `.${match[3]}` : ''
  return `${family} ${match[2]}${minor}`
}

export function buildLine(data: StatusData, options: StatusOptions): string | undefined {
  if (options.mode === 'off') return undefined
  const isOnlyOwn = options.mode === 'auto' && data.hasOwnStatusLine
  const on = (segment: Segment) => options.segments[segment] && (!isOnlyOwn || segment === 'chatchat')
  const parts: string[] = []

  if (on('dir') && data.dir) parts.push(`📁 ${data.dir}`)
  if (on('bun') && data.bun) parts.push(`⚡ ${data.bun}`)
  if (on('branch') && data.branch) parts.push(`🌿 ${data.branch}${data.isDirty ? '*' : ''}`)
  if (on('model') && data.model) parts.push(`🤖 ${data.model}`)
  if (on('cost') && data.costUsd !== undefined) parts.push(`💸 ${money(data.costUsd)}`)
  if (on('daily') && data.dailyUsd !== undefined) parts.push(`💰 ${money(data.dailyUsd)}/day`)
  if (on('limit') && data.fiveHour) {
    const left = timeLeft(data.fiveHour.resetsAt, data.now)
    if (left) parts.push(`⏰ ${limitMarker(data.fiveHour.percentUsed)}${left}`)
  }
  if (on('chatchat') && data.chatchat) parts.push(data.chatchat)

  return parts.length === 0 ? undefined : parts.join(SEP)
}
