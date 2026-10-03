// Self-hosted chat relay: `bun relay-server.ts [--port 8787] [--host 0.0.0.0]`.
// Rooms are opaque ids derived from invite codes; the relay never sees the code.
import { networkInterfaces } from 'node:os'
import { cleanMember, cleanMessage, line, parseWire, type Member } from './protocol'

type Conn = { room: string; member: Member | null; sent: number[] }

const ROOM_PATTERN = /^[a-f0-9]{16,64}$/
const RATE_WINDOW_MS = 5_000
const RATE_MAX = 10

export function startRelay(port: number, hostname = '0.0.0.0') {
  const rooms = new Map<string, Set<import('bun').ServerWebSocket<Conn>>>()

  const membersOf = (room: string): Member[] =>
    [...(rooms.get(room) ?? [])].map(ws => ws.data.member).filter((m): m is Member => m !== null)

  const announce = (room: string) => {
    const frame = JSON.stringify({ kind: 'members', members: membersOf(room) })
    for (const ws of rooms.get(room) ?? []) ws.send(frame)
  }

  const server = Bun.serve<Conn>({
    port,
    hostname,
    fetch(req, srv) {
      const room = new URL(req.url).searchParams.get('room') ?? ''
      if (!ROOM_PATTERN.test(room)) return new Response('chatchat relay', { status: 400 })
      if (srv.upgrade(req, { data: { room, member: null, sent: [] } })) return undefined
      return new Response('chatchat relay: websocket only', { status: 426 })
    },
    websocket: {
      maxPayloadLength: 4096,
      open(ws) {
        const set = rooms.get(ws.data.room) ?? new Set()
        set.add(ws)
        rooms.set(ws.data.room, set)
      },
      message(ws, raw) {
        const wire = parseWire(String(raw))
        if (!wire) return
        if (wire.kind === 'hello' || wire.kind === 'presence') {
          const member = cleanMember(wire.member)
          if (!member) return
          ws.data.member = member
          return announce(ws.data.room)
        }
        if (wire.kind === 'msg') {
          const now = Date.now()
          ws.data.sent = ws.data.sent.filter(at => now - at < RATE_WINDOW_MS)
          if (ws.data.sent.length >= RATE_MAX || !ws.data.member) return
          ws.data.sent.push(now)
          const msg = cleanMessage({ ...wire.msg, from: ws.data.member.nick, fromId: ws.data.member.id, at: now })
          if (!msg) return
          const frame = JSON.stringify({ kind: 'msg', msg })
          for (const peer of rooms.get(ws.data.room) ?? []) if (peer !== ws) peer.send(frame)
        }
      },
      close(ws) {
        const set = rooms.get(ws.data.room)
        set?.delete(ws)
        if (set && set.size === 0) rooms.delete(ws.data.room)
        else announce(ws.data.room)
      },
    },
  })
  return server
}

export function lanUrls(port: number): string[] {
  const urls: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`ws://${net.address}:${port}`)
    }
  }
  return urls
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const port = Number(flag('--port') ?? 8787)
  const server = startRelay(port, flag('--host') ?? '0.0.0.0')
  process.stdout.write(line({ t: 'hosting', port: server.port, urls: lanUrls(server.port) }))
}
