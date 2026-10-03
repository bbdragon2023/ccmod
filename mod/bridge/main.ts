// chatchat bridge: `bun main.ts --socket <path> --url <ws relay> --room <id> --nick <name>`.
// Talks to the mod via stdout JSON lines (events) and a Unix-socket HTTP server
// (commands: POST /send {text}, POST /presence {state}, POST /leave).
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { cleanMember, cleanMessage, line, parseWire, sanitize, type Member, type PresenceState } from './protocol'

const MAX_BACKOFF_MS = 30_000

export type BridgeOptions = { socket: string; url: string; room: string; nick: string; id?: string }

export function startBridge(options: BridgeOptions, emit: (text: string) => void = t => void process.stdout.write(t)) {
  const me: Member = cleanMember({ id: options.id ?? crypto.randomUUID(), nick: options.nick, state: 'online' })!
  let ws: WebSocket | null = null
  let attempt = 0
  let isLeaving = false
  let retry: ReturnType<typeof setTimeout> | null = null

  const sendFrame = (frame: object) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
  }

  const connect = () => {
    const target = new URL(options.url)
    target.searchParams.set('room', options.room)
    ws = new WebSocket(target.toString())
    ws.onopen = () => {
      attempt = 0
      sendFrame({ kind: 'hello', member: me })
      emit(line({ t: 'status', status: 'online' }))
    }
    ws.onmessage = event => {
      const wire = parseWire(String(event.data))
      if (wire?.kind === 'msg') {
        const msg = cleanMessage(wire.msg)
        if (msg) emit(line({ t: 'msg', msg }))
      } else if (wire?.kind === 'members') {
        const members = (wire.members ?? []).map(cleanMember).filter((m): m is Member => m !== null)
        emit(line({ t: 'members', members }))
      }
    }
    ws.onclose = () => {
      if (isLeaving) return
      attempt += 1
      emit(line({ t: 'status', status: 'reconnecting', attempt }))
      retry = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1)))
    }
    ws.onerror = () => ws?.close()
  }

  if (existsSync(options.socket)) unlinkSync(options.socket)
  const control = Bun.serve({
    unix: options.socket,
    async fetch(req) {
      const path = new URL(req.url).pathname
      const body = (await req.json().catch(() => ({}))) as { text?: unknown; state?: unknown }
      if (path === '/send') {
        const text = sanitize(String(body.text ?? ''))
        if (!text) return Response.json({ ok: false, reason: 'empty' }, { status: 400 })
        if (ws?.readyState !== WebSocket.OPEN) return Response.json({ ok: false, reason: 'offline' }, { status: 503 })
        const msg = { id: crypto.randomUUID(), from: me.nick, fromId: me.id, text, at: Date.now() }
        sendFrame({ kind: 'msg', msg })
        return Response.json({ ok: true, msg })
      }
      if (path === '/presence') {
        const state = body.state as PresenceState
        me.state = state === 'waiting' || state === 'focus' ? state : 'online'
        sendFrame({ kind: 'presence', member: me })
        return Response.json({ ok: true })
      }
      if (path === '/leave') {
        setTimeout(stop, 10)
        return Response.json({ ok: true })
      }
      return Response.json({ ok: false, reason: 'unknown' }, { status: 404 })
    },
  })
  chmodSync(options.socket, 0o600)

  function stop() {
    isLeaving = true
    if (retry) clearTimeout(retry)
    ws?.close()
    control.stop(true)
    if (existsSync(options.socket)) unlinkSync(options.socket)
  }

  emit(line({ t: 'ready' }))
  connect()
  return { stop, me }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const socket = flag('--socket')
  const url = flag('--url')
  const room = flag('--room')
  const nick = flag('--nick') ?? '匿名'
  if (!socket || !url || !room) {
    process.stdout.write(line({ t: 'error', message: 'usage: --socket <path> --url <ws://host:port> --room <id> --nick <name>' }))
    process.exit(2)
  }
  const bridge = startBridge({ socket, url, room, nick, id: flag('--id') })
  const quit = () => {
    bridge.stop()
    process.exit(0)
  }
  process.on('SIGTERM', quit)
  process.on('SIGINT', quit)
  // The mod closes our stdin at start; exit when the mod's reader goes away.
  process.stdout.on('error', quit)
}
