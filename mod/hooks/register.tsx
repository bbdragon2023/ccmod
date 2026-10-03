/* @jsx h */
import { atom, read } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { Chat, GameId, Life } from '../types'
import { OFFER_DELAY_MS, SNOOZE_MS, alertFor, formatElapsed, initialLife, isPaused, reduce, type LifeEvent } from './lifecycle'
import { DEFAULT_THEME, THEME_NAMES, isThemeName, themeOf } from './theme/tokens'
import { DEFAULT_OPTIONS, SEGMENTS, buildLine, prettyModel, type Segment, type StatusMode, type StatusOptions } from './statusline/segments'
import { asLedger, dayKey, record, staleKeys, total } from './statusline/ledger'
import type { ArcadeMessage, ArcadeProps } from './arcade/ArcadeClient'
import type { Phase, Room, Tab } from '../types'
import { initialChat, isRelayUrl, makeCode, normalizeCode, presenceOf, reduceChat, roomIdOf, splitLines, type ChatEvent } from './chat/state'
import { chatView, unreadRow } from './chat/view'

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
const CHAT = { plugin: 'chatchat', key: 'chat' } as const
const TAB = { plugin: 'chatchat', key: 'tab' } as const
const bestAtom = atom(BEST, {} as Record<string, number>)
const chatAtom = atom(CHAT, initialChat)
const tabAtom = atom(TAB, 'game' as const)

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
  if (before.phase !== after.phase) void syncPresence($, after.phase).catch(err => log($, 'presence', err))
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

function lifeSegment(life: Life, now: number, mark: string): string {
  if (life.phase === 'working' && life.turnStartedAt !== null) return `${mark} Claude ${formatElapsed(now - life.turnStartedAt)}`
  if (life.phase === 'needsYou') return `${mark} Claude 做完了${life.lastDurationMs === null ? '' : ` ${formatElapsed(life.lastDurationMs)}`}`
  if (life.phase === 'needsPermission') return `${mark} 等你授權`
  return `${mark} chatchat`
}

function chatchatSegment(life: Life, now: number, mark: string, chat: Chat): string {
  const parts = [lifeSegment(life, now, mark)]
  if (chat.status === 'online') parts.push(`▲${Math.max(0, chat.members.length - 1)} 在線`)
  if (chat.status === 'reconnecting') parts.push('聊天斷線')
  if (chat.unread > 0) parts.push(`${chat.unread} 則未讀`)
  return parts.join(' · ')
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
        chatchat: chatchatSegment(await getLife($), now, theme.mark, await getChat($)),
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
  setPaneOpen(true)
  return opened.isPlaced ? '已開啟 chatchat。先點一下遊戲區，鍵盤就會交給遊戲；Esc 回提示框。' : '終端機太窄，面板暫時放不下；拉寬視窗就會出現。'
}

const CHAT_HELP = [
  '/chatchat host [port]        在這台電腦開聊天伺服器（同網路或 Tailscale 的朋友可連）',
  '/chatchat server <ws://…>    使用別人開的聊天伺服器',
  '/chatchat invite [房名]      開聊天室，拿邀請碼',
  '/chatchat join <邀請碼> [ws://…]  加入聊天室',
  '/chatchat chat               打開聊天分頁',
  '/chatchat nick <暱稱>        改暱稱',
  '/chatchat leave              離開聊天室',
]

const HELP = [
  '/chatchat                   開遊戲面板',
  '/chatchat close             關掉面板',
  '/chatchat theme [名稱]       studio · riso · pocket',
  '/chatchat statusline [模式]  auto · full · off',
  '/chatchat statusline <段> on|off   段：' + SEGMENTS.join(' · '),
  ...CHAT_HELP,
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
  if (verb === 'chat') {
    await showTab($, 'chat')
    return openPane($)
  }
  const chatAnswer = await chatCommand($, verb, rest)
  if (chatAnswer !== null) {
    void refreshStatus($, false)
    return chatAnswer
  }
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

// ---- Chat bridge process (kept in this file: $ never crosses an import) ----

type Running = { stream: AsyncIterator<unknown>; socket: string }

let bridgeRun: Running | null = null
let relay: AsyncIterator<unknown> | null = null

type StartOptions = { url: string; roomId: string; nick: string; myId: string }

type ExitReason = 'missing' | 'exited' | 'stopped'

async function tmpDir($: $): Promise<string> {
  const dir = (await $.env.get('TMPDIR')) ?? '/tmp'
  return dir.endsWith('/') ? dir.slice(0, -1) : dir
}

// Reads a child's stdout as JSON lines until it ends; never throws.
async function pump(stream: AsyncIterable<{ stream: string; text: string }>, onEvent: (event: unknown) => void): Promise<boolean> {
  let buffer = ''
  let hasStarted = false
  try {
    for await (const chunk of stream) {
      hasStarted = true
      if (chunk.stream !== 'stdout') continue
      const { lines, rest } = splitLines(buffer, chunk.text)
      buffer = rest
      for (const text of lines) {
        try {
          onEvent(JSON.parse(text))
        } catch {
          // Not a protocol line (a stray log); ignore it.
        }
      }
    }
    return true
  } catch {
    return hasStarted
  }
}

async function startBridge($: $, options: StartOptions, onEvent: (event: unknown) => void, onExit: (reason: ExitReason) => void): Promise<void> {
  await stopBridge($)
  const socket = `${await tmpDir($)}/cc-${options.myId.slice(0, 8)}.sock`
  const stream = $.process.spawn({
    argv: ['bun', `${$.plugin.root}/bridge/main.ts`, '--socket', socket, '--url', options.url, '--room', options.roomId, '--nick', options.nick, '--id', options.myId],
  })
  const running: Running = { stream: stream as unknown as AsyncIterator<unknown>, socket }
  bridgeRun = running
  void pump(stream as unknown as AsyncIterable<{ stream: string; text: string }>, onEvent).then(didStart => {
    if (bridgeRun !== running) return onExit('stopped')
    bridgeRun = null
    onExit(didStart ? 'exited' : 'missing')
  })
}

async function stopBridge($: $): Promise<void> {
  const running = bridgeRun
  if (!running) return
  bridgeRun = null
  await post($, running.socket, '/leave', {}).catch(() => undefined)
  await running.stream.return?.()
}

async function post($: $, socket: string, path: string, body: object): Promise<{ ok: boolean; reason?: string; msg?: unknown }> {
  const res = await $.http.fetch(`http://bridge${path}`, {
    method: 'POST',
    socketPath: socket,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  try {
    return JSON.parse(res.text) as { ok: boolean; reason?: string; msg?: unknown }
  } catch {
    return { ok: false, reason: 'bad-response' }
  }
}

async function sendText($: $, text: string): Promise<{ ok: boolean; reason?: string; msg?: unknown }> {
  if (!bridgeRun) return { ok: false, reason: 'offline' }
  return post($, bridgeRun.socket, '/send', { text }).catch(() => ({ ok: false, reason: 'offline' }))
}

async function sendPresence($: $, state: string): Promise<void> {
  if (bridgeRun) await post($, bridgeRun.socket, '/presence', { state }).catch(() => undefined)
}

function isBridgeRunning(): boolean {
  return bridgeRun !== null
}

// Hosts a relay on this machine; resolves with its port and LAN addresses.
async function startRelay($: $, port: number): Promise<{ port: number; urls: string[] } | null> {
  if (relay) await relay.return?.()
  const stream = $.process.spawn({ argv: ['bun', `${$.plugin.root}/bridge/relay-server.ts`, '--port', String(port)] })
  relay = stream as unknown as AsyncIterator<unknown>
  return new Promise(resolve => {
    let isResolved = false
    void pump(stream as unknown as AsyncIterable<{ stream: string; text: string }>, event => {
      const e = event as { t?: string; port?: number; urls?: string[] }
      if (!isResolved && e.t === 'hosting' && typeof e.port === 'number') {
        isResolved = true
        resolve({ port: e.port, urls: Array.isArray(e.urls) ? e.urls : [] })
      }
    }).then(() => {
      relay = null
      if (!isResolved) resolve(null)
    })
  })
}

async function stopRelay(): Promise<void> {
  const running = relay
  relay = null
  await running?.return?.()
}

function isHosting(): boolean {
  return relay !== null
}

// ---- Chat controller ----


const DEFAULT_PORT = 8787

// Module memory, rebuilt by loadChat() on every (re)load.
let nick = ''
let serverUrl = ''
let myId = ''
let hostUrls: string[] = []
let isPaneOpen = false

function setPaneOpen(isOpen: boolean): void {
  isPaneOpen = isOpen
}

async function getChat($: $): Promise<Chat> {
  return (await $.state.get(CHAT)).value ?? initialChat
}

async function isViewing($: $): Promise<boolean> {
  return isPaneOpen && (await $.state.get(TAB)).value === 'chat'
}

async function chatDispatch($: $, event: ChatEvent): Promise<Chat> {
  const before = await getChat($)
  const after = reduceChat(before, event, await isViewing($))
  if (after !== before) await $.state.set(CHAT, after)
  return after
}

async function showTab($: $, tab: Tab): Promise<void> {
  await $.state.set(TAB, tab)
  if (tab === 'chat') await chatDispatch($, { type: 'viewed' })
}

async function loadChat($: $, sessionId: string): Promise<void> {
  myId = sessionId || crypto.randomUUID()
  const savedNick = await $.store.get('nick')
  nick = typeof savedNick === 'string' && savedNick ? savedNick : await gitUserName($)
  const savedServer = await $.store.get('server')
  serverUrl = typeof savedServer === 'string' ? savedServer : ''
  const savedRoom = (await $.store.get('room')) as Room | undefined
  // A reload (or a new session) rejoins the room you were in.
  if (savedRoom?.code && savedRoom.url) await join($, savedRoom)
  else if (!serverUrl) await $.state.set(CHAT, { ...initialChat, status: 'unconfigured' })
}

async function gitUserName($: $): Promise<string> {
  try {
    const r = await $.process.run(['git', 'config', 'user.name'], { timeoutMs: 2000 })
    return r.stdout.trim().split(/\s+/)[0] || '我'
  } catch {
    return '我'
  }
}

async function join($: $, room: Room): Promise<void> {
  await chatDispatch($, { type: 'starting', room, myId })
  await $.store.set('room', room)
  const roomId = await roomIdOf(room.code)
  await startBridge(
    $,
    { url: room.url, roomId, nick, myId },
    event => void chatDispatch($, { type: 'bridge', event }),
    reason => {
      if (reason === 'stopped') return
      void chatDispatch($, {
        type: 'stopped',
        status: reason === 'missing' ? 'missing' : 'error',
        note: reason === 'missing' ? '聊天需要 Bun（https://bun.sh）。裝好後輸入 /chatchat join 重試。' : '橋接程式結束了。輸入 /chatchat join 重新連線。',
      })
    },
  )
}

async function syncPresence($: $, phase: Phase): Promise<void> {
  if (isBridgeRunning()) await sendPresence($, presenceOf(phase))
}

async function send($: $, text: string): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  const res = await sendText($, trimmed)
  if (!res.ok) return res.reason === 'offline' ? '還沒連上聊天室，訊息沒送出。' : '訊息沒送出。'
  const msg = res.msg as { id: string; from: string; fromId: string; text: string; at: number } | undefined
  if (msg) await chatDispatch($, { type: 'sent', msg })
  return null
}

function inviteUrl(): string {
  // Friends cannot reach 127.0.0.1; hand them this machine's LAN address.
  if (hostUrls.length > 0 && /127\.0\.0\.1|localhost/.test(serverUrl)) return hostUrls[0]!
  return serverUrl
}

const NO_SERVER = '還沒有聊天伺服器。\n· 自己開一個：/chatchat host\n· 或連朋友的：/chatchat server ws://朋友的IP:8787'


async function chatCommand($: $, verb: string, rest: string[]): Promise<string | null> {
  if (verb === 'host') {
    const port = Number(rest[0] ?? DEFAULT_PORT)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return 'port 要是 1024–65535 之間的數字。'
    const hosted = await startRelay($, port)
    if (!hosted) return '開不起來：需要 Bun（https://bun.sh），或這個 port 已經被佔用。'
    hostUrls = hosted.urls
    serverUrl = `ws://127.0.0.1:${hosted.port}`
    await $.store.set('server', serverUrl)
    const lan = hosted.urls.length > 0 ? hosted.urls.join('、') : '（找不到區網位址）'
    return `聊天伺服器已在這台電腦開好（port ${hosted.port}）。\n朋友用這個位址連：${lan}\n注意：同一個網路裡知道邀請碼的人都能加入；不在同網路的朋友可以用 Tailscale。\n下一步：/chatchat invite`
  }
  if (verb === 'server') {
    const url = rest[0] ?? ''
    if (!url) return serverUrl ? `目前的聊天伺服器：${serverUrl}${isHosting() ? '（本機）' : ''}` : NO_SERVER
    if (!isRelayUrl(url)) return '位址格式要像 ws://192.168.1.5:8787'
    serverUrl = url.replace(/\/$/, '')
    await $.store.set('server', serverUrl)
    if ((await getChat($)).status === 'unconfigured') await $.state.set(CHAT, initialChat)
    return `聊天伺服器設為 ${serverUrl}。下一步：/chatchat invite 或 /chatchat join <邀請碼>`
  }
  if (verb === 'invite') {
    if (!serverUrl) return NO_SERVER
    const code = makeCode(crypto.getRandomValues(new Uint8Array(12)))
    const name = rest.join(' ').trim().slice(0, 24) || '聊天室'
    await join($, { code, name, url: serverUrl })
    await showTab($, 'chat')
    return `聊天室「${name}」開好了。把這行傳給朋友：\n\n  /chatchat join ${code} ${inviteUrl()}\n\n不想要了就 /chatchat leave（之後換一組新碼）。`
  }
  if (verb === 'join') {
    const saved = (await $.store.get('room')) as Room | undefined
    const code = rest[0] ? normalizeCode(rest[0]) : saved?.code ?? null
    if (!code) return '邀請碼格式不對，應該像 K7QX-2MPF-9HVD。'
    const url = rest[1] ? rest[1].replace(/\/$/, '') : saved?.code === code ? saved.url : serverUrl
    if (!url || !isRelayUrl(url)) return NO_SERVER
    if (rest[1]) {
      serverUrl = url
      await $.store.set('server', url)
    }
    await join($, { code, name: saved?.code === code ? saved.name : '聊天室', url })
    await showTab($, 'chat')
    return `正在加入聊天室（暱稱：${nick}）。打開面板看聊天：/chatchat chat`
  }
  if (verb === 'leave') {
    await stopBridge($)
    await $.store.delete('room')
    await chatDispatch($, { type: 'stopped', status: 'off' })
    return '已離開聊天室。'
  }
  if (verb === 'nick') {
    const name = rest.join(' ').trim().slice(0, 24)
    if (!name) return `目前暱稱：${nick}`
    nick = name
    await $.store.set('nick', nick)
    const room = (await getChat($)).room
    if (room && isBridgeRunning()) await join($, room)
    return `暱稱改成 ${nick}。`
  }
  return null
}

async function shutdownChat(): Promise<void> {
  await stopRelay()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (!e.isInteractive) return started
    cwd = e.cwd
    try {
      await $.command.register({
        name: 'chatchat',
        description: '等 Claude 時玩小遊戲、跟朋友聊天；主題與 statusline 設定',
        argumentHint: '[play|chat|invite|join <碼>|host|theme|statusline|help]',
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
    await loadChat($, sessionId).catch(err => log($, 'chat', err))
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
    const chat = await read($, chatAtom)
    const tab = await read($, tabAtom)
    const { Box, Button, Text } = $.ui.resolve(e)
    const rest = await next(e)
    const isChatShown = (await $.ui.panes()).some(pane => pane.id === PANE) && tab === 'chat'
    const unread =
      chat.unread > 0 && !isChatShown
        ? unreadRow({ Box, Text, Button }, chat, theme, () => {
            void showTab($, 'chat').then(() => openPane($))
          })
        : null

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
    return band || unread ? (
      <Box flexDirection="column">
        {band}
        {unread}
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
    const { Box, Button, Client, Input, Text } = $.ui.resolve(e)
    const chat = await read($, chatAtom)
    const tab = await read($, tabAtom)
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
        <Box flexDirection="row" gap={1}>
          <Button key="tab-game" label={tab === 'game' ? '● 遊戲' : '遊戲'} onPress={() => showTab($, 'game')} />
          <Button key="tab-chat" label={`${tab === 'chat' ? '● ' : ''}聊天${chat.unread > 0 ? ` · ${chat.unread}` : ''}`} onPress={() => showTab($, 'chat')} />
          <Text color={theme.muted} backgroundColor={theme.surface}>
            {theme.mark} {theme.label} · {header}
          </Text>
        </Box>
        {tab === 'chat' ? (
          chatView({ Box, Text, Input }, chat, theme, e.props.scroll?.bodyRows ?? 20, text => {
            void send($, text).then(problem => problem && $.ui.toast(problem))
          })
        ) : (
          <Client key="arcade" module="./arcade/ArcadeClient.tsx" props={props} flexGrow={1} />
        )}
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

  on('ui.close', { id: PANE }, async ($, e, next) => {
    setPaneOpen(false)
    return next(e)
  })

  on('command.run', { command: 'chatchat' }, async ($, e) => ({ text: await runCommand($, e.args) }))
}
