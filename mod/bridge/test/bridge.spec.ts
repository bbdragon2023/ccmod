// Run with `bun test mod/bridge` (Bun APIs; not part of `claude plugin test`).
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanMessage, parseWire, sanitize } from '../protocol'
import { startRelay } from '../relay-server'
import { startBridge } from '../main'

const dir = mkdtempSync(join(tmpdir(), 'cc-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const ROOM = 'a'.repeat(32)

function collector() {
  const events: Array<Record<string, any>> = []
  return { events, emit: (text: string) => events.push(JSON.parse(text)) }
}

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await Bun.sleep(20)
  }
}

const post = (socket: string, path: string, body: object) =>
  fetch(`http://bridge${path}`, { method: 'POST', unix: socket, body: JSON.stringify(body) } as RequestInit).then(r => r.json())

describe('protocol', () => {
  test('sanitize strips escapes and control characters', () => {
    expect(sanitize('hi\u001b[31m red\u001b[0m')).toBe('hi red')
    expect(sanitize('a\u0007b\nc')).toBe('a b c')
    expect(sanitize('x'.repeat(600)).length).toBe(500)
  })

  test('bad frames are dropped', () => {
    expect(parseWire('not json')).toBe(null)
    expect(parseWire('{"kind":"nope"}')).toBe(null)
    expect(cleanMessage({ id: '1', text: '   ' })).toBe(null)
  })
})

describe('relay + bridge', () => {
  const relay = startRelay(0, '127.0.0.1')
  const url = `ws://127.0.0.1:${relay.port}`
  afterAll(() => relay.stop(true))

  test('a message sent through one bridge reaches the other, not the sender', async () => {
    const a = collector()
    const b = collector()
    const sockA = join(dir, 'a.sock')
    const sockB = join(dir, 'b.sock')
    const bridgeA = startBridge({ socket: sockA, url, room: ROOM, nick: '小美' }, a.emit)
    const bridgeB = startBridge({ socket: sockB, url, room: ROOM, nick: '阿哲' }, b.emit)
    await until(() => b.events.some(e => e.t === 'members' && e.members.length === 2))
    expect(statSync(sockA).mode & 0o777).toBe(0o600)

    const sent = await post(sockA, '/send', { text: 'pg 連線池\u001b[31m 滿了' })
    expect(sent.ok).toBe(true)
    await until(() => b.events.some(e => e.t === 'msg'))
    const got = b.events.find(e => e.t === 'msg')!.msg
    expect(got.text).toBe('pg 連線池 滿了')
    expect(got.from).toBe('小美')
    expect(a.events.some(e => e.t === 'msg')).toBe(false)

    await post(sockA, '/presence', { state: 'waiting' })
    await until(() => b.events.some(e => e.t === 'members' && e.members.some((m: any) => m.nick === '小美' && m.state === 'waiting')))

    bridgeA.stop()
    await until(() => b.events.some(e => e.t === 'members' && e.members.length === 1))
    bridgeB.stop()
  })

  test('rooms are isolated', async () => {
    const a = collector()
    const c = collector()
    const bridgeA = startBridge({ socket: join(dir, 'a2.sock'), url, room: ROOM, nick: 'A' }, a.emit)
    const bridgeC = startBridge({ socket: join(dir, 'c.sock'), url, room: 'b'.repeat(32), nick: 'C' }, c.emit)
    await until(() => a.events.some(e => e.t === 'status' && e.status === 'online') && c.events.some(e => e.t === 'status'))
    await post(join(dir, 'a2.sock'), '/send', { text: 'hello' })
    await Bun.sleep(150)
    expect(c.events.some(e => e.t === 'msg')).toBe(false)
    bridgeA.stop()
    bridgeC.stop()
  })

  test('the bridge reports reconnecting when the relay is gone and rejects sends', async () => {
    const lonely = startRelay(0, '127.0.0.1')
    const d = collector()
    const sock = join(dir, 'd.sock')
    const bridge = startBridge({ socket: sock, url: `ws://127.0.0.1:${lonely.port}`, room: ROOM, nick: 'D' }, d.emit)
    await until(() => d.events.some(e => e.t === 'status' && e.status === 'online'))
    lonely.stop(true)
    await until(() => d.events.some(e => e.t === 'status' && e.status === 'reconnecting'))
    const res = await post(sock, '/send', { text: 'anyone?' })
    expect(res).toEqual({ ok: false, reason: 'offline' })
    bridge.stop()
  })
})
