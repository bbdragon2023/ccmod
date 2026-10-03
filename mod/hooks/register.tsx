/* @jsx h */
import { atom, read } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { GameId, Life } from '../types'
import { OFFER_DELAY_MS, SNOOZE_MS, alertFor, formatElapsed, initialLife, isPaused, reduce, type LifeEvent } from './lifecycle'
import { DEFAULT_THEME, THEME_NAMES, isThemeName, themeOf } from './theme/tokens'
import { DEFAULT_OPTIONS, SEGMENTS, buildLine, prettyModel, type Segment, type StatusMode, type StatusOptions } from './statusline/segments'
import { asLedger, dayKey, record, staleKeys, total } from './statusline/ledger'
import type { ArcadeMessage, ArcadeProps } from './arcade/ArcadeClient'

type $ = EngineInterface

const PANE = 'chatchat'
// Refs for $.state.get/set; atoms (with defaults) for reads while drawing.
const LIFE = { plugin: 'chatchat', key: 'life' } as const
const NOW = { plugin: 'chatchat', key: 'now' } as const
const THEME = { plugin: 'chatchat', key: 'theme' } as const
const BEST = { plugin: 'chatchat', key: 'best' } as const
const lifeAtom = atom(LIFE, initialLife)
const nowAtom = atom(NOW, 0)
const themeAtom = atom(THEME, DEFAULT_THEME)
const bestAtom = atom(BEST, {} as Record<string, number>)

const HEAVY_REFRESH_MS = 30_000
const GIT_TTL_MS = 15_000

// Module memory: rebuilt from $.store / the engine on every (re)load at session.start.
let options: StatusOptions = DEFAULT_OPTIONS
let hasOwnStatusLine = false
let cwd = ''
let sessionId = ''
let bunVersion: string | undefined
let git: { branch?: string; isDirty?: boolean; at: number } = { at: 0 }
let dailyUsd: number | undefined
let ticker: Timer | null = null
let offerTimer: Timer | null = null

const log = ($: $, what: string, err: unknown) => $.ui.log(`chatchat: ${what}: ${String(err)}`, { to: 'debug' })

async function getLife($: $): Promise<Life> {
  return (await $.state.get(LIFE)).value ?? initialLife
}

async function dispatch($: $, event: LifeEvent): Promise<void> {
  const before = await getLife($)
  const after = reduce(before, event)
  if (after === before) return
  await $.state.set(LIFE, after)
  await $.state.set(NOW, await $.clock.now())
  const alert = alertFor(before, after)
  if (alert) await announce($, alert, after)
  syncTicker($, after)
  void refreshStatus($, false)
}

async function announce($: $, alert: 'done' | 'permission', life: Life): Promise<void> {
  const theme = themeOf((await $.state.get(THEME)).value)
  const elapsed = life.lastDurationMs === null ? '' : ` (${formatElapsed(life.lastDurationMs)})`
  $.ui.toast(alert === 'done' ? `Claude 做完了${elapsed}` : 'Claude 需要你授權')
  const asset = alert === 'done' ? theme.sound.done : theme.sound.permission
  $.audio.play({ asset }).catch(err => log($, 'sound', err))
}

// A 1 s tick keeps the timers in the band, pane and status line moving.
function syncTicker($: $, life: Life): void {
  const isLive = life.phase === 'working' || (life.phase === 'needsYou' && life.snoozeUntil !== null)
  if (isLive && !ticker) {
    ticker = $.clock.every(1000, () => {
      void (async () => {
        const now = await $.clock.now()
        await $.state.set(NOW, now)
        const current = await getLife($)
        if (current.phase === 'needsYou' && current.snoozeUntil !== null && now >= current.snoozeUntil) {
          syncTicker($, { ...current, snoozeUntil: null })
        }
        await refreshStatus($, false)
      })().catch(err => log($, 'tick', err))
    })
  } else if (!isLive && ticker) {
    ticker.cancel()
    ticker = null
  }
}

async function refreshGit($: $, now: number): Promise<void> {
  if (now - git.at < GIT_TTL_MS || !cwd) return
  git = { at: now }
  try {
    const branch = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'], { timeoutMs: 2000 })
    if (branch.exitCode !== 0) return
    const status = await $.process.run(['git', '--no-optional-locks', '-C', cwd, 'status', '--porcelain'], { timeoutMs: 2000 })
    git = { branch: branch.stdout.trim() || undefined, isDirty: status.stdout.trim().length > 0, at: now }
  } catch (err) {
    log($, 'git', err)
  }
}

async function refreshLedger($: $, now: number, costUsd: number | undefined): Promise<void> {
  if (costUsd === undefined || !sessionId) return
  const key = dayKey(now)
  const ledger = record(asLedger(await $.store.get(key)), sessionId, costUsd)
  await $.store.set(key, ledger)
  dailyUsd = total(ledger)
}

function chatchatSegment(life: Life, now: number, mark: string): string {
  if (life.phase === 'working' && life.turnStartedAt !== null) return `${mark} Claude ${formatElapsed(now - life.turnStartedAt)}`
  if (life.phase === 'needsYou') return `${mark} Claude 做完了${life.lastDurationMs === null ? '' : ` ${formatElapsed(life.lastDurationMs)}`}`
  if (life.phase === 'needsPermission') return `${mark} 等你授權`
  return `${mark} chatchat`
}

async function refreshStatus($: $, isHeavy: boolean): Promise<void> {
  try {
    if (options.mode === 'off') return $.ui.status(undefined)
    const now = await $.clock.now()
    const usage = await $.session.usage()
    const costUsd = usage.cost?.usd
    if (isHeavy) await refreshLedger($, now, costUsd)
    await refreshGit($, now)
    const fiveHour = usage.rateLimits.find(limit => limit.kind === 'five_hour')
    const theme = themeOf((await $.state.get(THEME)).value)
    const line = buildLine(
      {
        now,
        hasOwnStatusLine,
        dir: cwd.split('/').filter(Boolean).pop(),
        bun: bunVersion,
        branch: git.branch,
        isDirty: git.isDirty,
        model: prettyModel(await $.session.model()),
        costUsd,
        dailyUsd,
        fiveHour: fiveHour ? { percentUsed: fiveHour.percentUsed, resetsAt: fiveHour.resetsAt } : undefined,
        chatchat: chatchatSegment(await getLife($), now, theme.mark),
      },
      options,
    )
    $.ui.status(line)
  } catch (err) {
    log($, 'status', err)
  }
}

async function loadOptions($: $): Promise<StatusOptions> {
  const saved = (await $.store.get('statusline')) as Partial<StatusOptions> | undefined
  const mode: StatusMode = saved?.mode === 'full' || saved?.mode === 'off' || saved?.mode === 'auto' ? saved.mode : DEFAULT_OPTIONS.mode
  const segments = { ...DEFAULT_OPTIONS.segments }
  for (const segment of SEGMENTS) {
    const value = saved?.segments?.[segment]
    if (typeof value === 'boolean') segments[segment] = value
  }
  return { mode, segments }
}

async function openPane($: $): Promise<string> {
  const opened = await $.ui.open({ id: PANE, title: 'chatchat' })
  return opened.isPlaced ? '已開啟 chatchat。先點一下遊戲區，鍵盤就會交給遊戲；Esc 回提示框。' : '終端機太窄，面板暫時放不下；拉寬視窗就會出現。'
}

const HELP = [
  '/chatchat                   開遊戲面板',
  '/chatchat close             關掉面板',
  '/chatchat theme [名稱]       studio · riso · pocket',
  '/chatchat statusline [模式]  auto · full · off',
  '/chatchat statusline <段> on|off   段：' + SEGMENTS.join(' · '),
].join('\n')

async function runCommand($: $, args: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (verb === '' || verb === 'play') return openPane($)
  if (verb === 'close' || verb === 'stop') {
    await $.ui.close({ id: PANE })
    return '已關閉 chatchat 面板。'
  }
  if (verb === 'help') return HELP
  if (verb === 'theme') {
    const name = rest[0]
    const current = (await $.state.get(THEME)).value ?? DEFAULT_THEME
    if (!name) return `目前主題：${themeOf(current).label}。可選：${THEME_NAMES.join(' · ')}`
    if (!isThemeName(name)) return `沒有「${name}」這個主題。可選：${THEME_NAMES.join(' · ')}`
    await $.state.set(THEME, name)
    await $.store.set('theme', name)
    void refreshStatus($, false)
    return `主題已換成 ${themeOf(name).label}。`
  }
  if (verb === 'statusline') return statuslineCommand($, rest)
  return `看不懂「${args.trim()}」。\n${HELP}`
}

async function statuslineCommand($: $, rest: string[]): Promise<string> {
  const [first, second] = rest
  if (!first) {
    const on = SEGMENTS.filter(segment => options.segments[segment]).join(' · ')
    const note = options.mode === 'auto' && hasOwnStatusLine ? '（偵測到你已有自己的 statusLine，只顯示 chatchat 段）' : ''
    return `statusline 模式：${options.mode}${note}\n顯示中的段：${on || '無'}`
  }
  if (first === 'auto' || first === 'full' || first === 'off') {
    options = { ...options, mode: first }
  } else if ((SEGMENTS as string[]).includes(first) && (second === 'on' || second === 'off')) {
    options = { ...options, segments: { ...options.segments, [first as Segment]: second === 'on' } }
  } else {
    return `用法：/chatchat statusline auto|full|off，或 /chatchat statusline <段> on|off（段：${SEGMENTS.join(' · ')}）`
  }
  await $.store.set('statusline', options)
  await refreshStatus($, true)
  return `statusline 已更新：模式 ${options.mode}。`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (!e.isInteractive) return started
    cwd = e.cwd
    try {
      await $.command.register({
        name: 'chatchat',
        description: '等 Claude 時玩小遊戲；主題與 statusline 設定',
        argumentHint: '[play|close|theme <名稱>|statusline <模式>]',
        immediate: true,
      })
      sessionId = await $.session.id()
      options = await loadOptions($)
      const savedTheme = await $.store.get('theme')
      if (isThemeName(savedTheme)) await $.state.set(THEME, savedTheme)
      const savedBest = await $.store.get('best')
      if (savedBest && typeof savedBest === 'object') await $.state.set(BEST, savedBest as Record<string, number>)
      hasOwnStatusLine = Boolean((await $.settings.read()).statusLine)
      for (const key of staleKeys(await $.store.keys(), await $.clock.now())) await $.store.delete(key)
    } catch (err) {
      log($, 'start', err)
    }
    $.process
      .run(['bun', '--version'], { timeoutMs: 3000 })
      .then(r => {
        if (r.exitCode === 0) bunVersion = r.stdout.trim() || undefined
      })
      .catch(() => undefined)
    syncTicker($, await getLife($))
    $.clock.every(HEAVY_REFRESH_MS, () => void refreshStatus($, true))
    void refreshStatus($, true)
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    await dispatch($, { type: 'back' }).catch(err => log($, 'back', err))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    await dispatch($, { type: 'turnStart', at: await $.clock.now() })
    offerTimer?.cancel()
    offerTimer = $.clock.after(OFFER_DELAY_MS, () => void dispatch($, { type: 'offerDue' }))
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) return done // a subagent's turn, not the session's
    offerTimer?.cancel()
    offerTimer = null
    await dispatch($, { type: 'turnComplete', at: await $.clock.now(), isAborted: e.isAborted })
    void refreshStatus($, true)
    return done
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id) await dispatch($, { type: 'needsInput' })
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion') await dispatch($, { type: 'needsInput' })
    const ran = await next(e)
    await dispatch($, { type: 'inputSettled' })
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const life = await read($, lifeAtom)
    const now = await read($, nowAtom)
    const theme = themeOf(await read($, themeAtom))
    const { Box, Button, Text } = $.ui.resolve(e)
    const rest = await next(e)

    let band = null
    if (life.phase === 'working' && life.offer === 'shown' && life.turnStartedAt !== null) {
      band = (
        <Box borderStyle="round" borderColor={theme.edge} paddingX={1} gap={2}>
          <Text color={theme.accent}>
            {theme.mark} Claude 工作中 {formatElapsed(now - life.turnStartedAt)}
          </Text>
          <Text dimColor>要玩一下嗎？</Text>
          {/* No hotkeys: a band hotkey would fire on the first letter typed into the prompt. */}
          <Button key="play" label="玩一下" variant="primary" onPress={() => openPane($).then(text => $.ui.toast(text))} />
          <Button key="skip" label="這次不用" onPress={() => dispatch($, { type: 'offerDismissed' })} />
        </Box>
      )
    } else if (life.phase === 'needsPermission') {
      band = (
        <Box borderStyle="round" borderColor={theme.danger} paddingX={1}>
          <Text color={theme.danger}>{theme.mark} 等你授權 · 鍵盤在 Claude 的選單上</Text>
        </Box>
      )
    }
    return band ? (
      <Box flexDirection="column">
        {band}
        {rest}
      </Box>
    ) : (
      rest
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>chatchat 的遊戲目前只支援終端機。</Text>
    }
    const { Box, Client, Text } = $.ui.resolve(e)
    const life = await read($, lifeAtom)
    const now = await read($, nowAtom)
    const theme = themeOf(await read($, themeAtom))
    const best = await read($, bestAtom)
    const paused = isPaused(life, now)
    const elapsed =
      life.phase === 'working' && life.turnStartedAt !== null
        ? formatElapsed(now - life.turnStartedAt)
        : life.lastDurationMs !== null
          ? formatElapsed(life.lastDurationMs)
          : null
    const props: ArcadeProps = {
      theme,
      paused,
      reason: life.phase === 'needsPermission' ? 'permission' : paused ? 'done' : null,
      canSnooze: life.phase === 'needsYou' && !life.hasSnoozed,
      elapsed,
      best,
    }
    const header =
      life.phase === 'working' ? `Claude 工作中 ${elapsed ?? ''}` : life.phase === 'idle' ? '閒置中' : paused ? '已暫停' : '再玩一下'
    return (
      <Box flexDirection="column" backgroundColor={theme.surface}>
        <Text color={theme.muted} backgroundColor={theme.surface}>
          {theme.mark} chatchat · {theme.label} · {header}
        </Text>
        <Client key="arcade" module="./arcade/ArcadeClient.tsx" props={props} flexGrow={1} />
      </Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    const data = e.data as ArcadeMessage
    if (data?.type === 'back') {
      await dispatch($, { type: 'back' })
      await $.ui.close({ id: PANE })
    } else if (data?.type === 'snooze') {
      await dispatch($, { type: 'snooze', at: await $.clock.now() })
      $.clock.after(SNOOZE_MS + 50, () => void $.clock.now().then(now => $.state.set(NOW, now)))
    } else if (data?.type === 'best') {
      const best = await read($, bestAtom)
      const previous = best[data.game as GameId]
      const isBetter = data.score > 0 && (previous === undefined || (data.isLowerBetter ? data.score < previous : data.score > previous))
      if (isBetter) {
        const updated = { ...best, [data.game]: data.score }
        await $.state.set(BEST, updated)
        await $.store.set('best', updated)
        $.ui.toast('新紀錄！')
      }
    }
    return next(e)
  })

  on('command.run', { command: 'chatchat' }, async ($, e) => ({ text: await runCommand($, e.args) }))
}
