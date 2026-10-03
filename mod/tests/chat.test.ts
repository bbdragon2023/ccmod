import { describe, expect, test } from 'claude-code/testing'
import type { Chat } from '../types'
import { MAX_MESSAGES, friendColor, initialChat, isRelayUrl, makeCode, normalizeCode, presenceOf, reduceChat, roomIdOf, splitLines } from '../hooks/chat/state'

const room = { code: 'K7QX-2MPF-9HVD', name: '週末 vibe', url: 'ws://127.0.0.1:8787' }
const started = reduceChat(initialChat, { type: 'starting', room, myId: 'me' }, false)
const online = reduceChat(started, { type: 'bridge', event: { v: 1, t: 'status', status: 'online' } }, false)
const msg = (id: string, fromId = 'mei') => ({ v: 1, t: 'msg', msg: { id, from: '小美', fromId, text: 'hi', at: 1 } })

describe('chat state', () => {
  test('joining goes starting then online', async () => {
    expect(started.status).toBe('starting')
    expect(online.status).toBe('online')
    expect(online.room).toEqual(room)
  })

  test('a friend message counts as unread unless the chat tab is on screen', async () => {
    const unseen = reduceChat(online, { type: 'bridge', event: msg('1') }, false)
    expect(unseen.unread).toBe(1)
    expect(unseen.messages[0]!.isMine).toBe(false)
    const seen = reduceChat(online, { type: 'bridge', event: msg('1') }, true)
    expect(seen.unread).toBe(0)
    expect(reduceChat(unseen, { type: 'viewed' }, true).unread).toBe(0)
  })

  test('my own echo is not unread and duplicates are dropped', async () => {
    const mine = reduceChat(online, { type: 'bridge', event: msg('2', 'me') }, false)
    expect(mine.unread).toBe(0)
    expect(mine.messages[0]!.isMine).toBe(true)
    expect(reduceChat(mine, { type: 'bridge', event: msg('2', 'me') }, false)).toBe(mine)
  })

  test('sent messages are kept and the history is capped', async () => {
    let chat: Chat = online
    for (let i = 0; i < MAX_MESSAGES + 5; i++) chat = reduceChat(chat, { type: 'sent', msg: { id: `s${i}`, from: '我', fromId: 'me', text: 'x', at: i } }, false)
    expect(chat.messages.length).toBe(MAX_MESSAGES)
    expect(chat.messages[0]!.id).toBe('s5')
  })

  test('reconnecting tracks the attempt and online clears it', async () => {
    const down = reduceChat(online, { type: 'bridge', event: { v: 1, t: 'status', status: 'reconnecting', attempt: 3 } }, false)
    expect(down.status).toBe('reconnecting')
    expect(down.attempt).toBe(3)
    expect(reduceChat(down, { type: 'bridge', event: { v: 1, t: 'status', status: 'online' } }, false).attempt).toBe(0)
  })

  test('a different protocol version is reported, not trusted', async () => {
    const odd = reduceChat(online, { type: 'bridge', event: { v: 9, t: 'msg', msg: { id: 'x' } } }, false)
    expect(odd.status).toBe('error')
    expect(odd.messages.length).toBe(0)
  })

  test('garbage bridge events change nothing', async () => {
    expect(reduceChat(online, { type: 'bridge', event: 'nope' }, false)).toBe(online)
    expect(reduceChat(online, { type: 'bridge', event: { v: 1, t: 'msg' } }, false)).toBe(online)
  })

  test('leaving clears the room and members; a missing runtime keeps the room to retry', async () => {
    const left = reduceChat(online, { type: 'stopped', status: 'off' }, false)
    expect(left.room).toBe(null)
    const missing = reduceChat(online, { type: 'stopped', status: 'missing', note: 'need bun' }, false)
    expect(missing.room).toEqual(room)
    expect(missing.note).toBe('need bun')
  })
})

describe('invite codes and rooms', () => {
  test('codes are 3 groups of 4 from the unambiguous alphabet', async () => {
    const code = makeCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(code).not.toMatch(/[01OIL]/)
  })

  test('typed codes are normalized, wrong ones refused', async () => {
    expect(normalizeCode('k7qx 2mpf 9hvd')).toBe('K7QX-2MPF-9HVD')
    expect(normalizeCode('K7QX-2MPF')).toBe(null)
    expect(normalizeCode('K7QX-2MPF-9HV0')).toBe(null)
  })

  test('the relay sees a stable hash, never the code', async () => {
    const id = await roomIdOf('K7QX-2MPF-9HVD')
    expect(id).toMatch(/^[a-f0-9]{32}$/)
    expect(await roomIdOf('K7QX-2MPF-9HVD')).toBe(id)
    expect(await roomIdOf('K7QX-2MPF-9HVE')).not.toBe(id)
  })

  test('relay urls must be ws or wss host[:port]', async () => {
    expect(isRelayUrl('ws://192.168.1.5:8787')).toBe(true)
    expect(isRelayUrl('wss://chat.example.com')).toBe(true)
    expect(isRelayUrl('http://x:1')).toBe(false)
    expect(isRelayUrl('ws://a b')).toBe(false)
  })

  test('presence shares only a coarse state', async () => {
    expect(presenceOf('idle')).toBe('online')
    expect(presenceOf('working')).toBe('waiting')
    expect(presenceOf('needsPermission')).toBe('waiting')
  })

  test('a friend keeps one colour', async () => {
    const palette = ['#a', '#b', '#c']
    expect(friendColor('mei', palette)).toBe(friendColor('mei', palette))
  })
})

describe('bridge output', () => {
  test('lines split across chunks are rebuilt', async () => {
    const first = splitLines('', '{"a":1}\n{"b":')
    expect(first.lines).toEqual(['{"a":1}'])
    const second = splitLines(first.rest, '2}\n\n')
    expect(second.lines).toEqual(['{"b":2}'])
    expect(second.rest).toBe('')
  })
})

const PANE = {
  plugin: 'chatchat',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'chatchat',
  viewport: { columns: 140, rows: 40 },
  props: { title: 'chatchat', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

describe('chat tab', () => {
  test('the chat tab explains how to start a room when not in one', async $ => {
    const ui = await $.ui.mount<'terminal', 'Pane'>(PANE as never)
    await ui.press({ key: 'tab-chat' })
    expect(await ui.find({ text: /還沒加入聊天室/ })).toBeDefined()
    expect(await ui.find({ text: /不會傳給 Claude/ })).toBeDefined()
    await ui.press({ key: 'tab-game' })
    await ui.resize({ columns: 56, rows: 24, in: 'arcade' })
    expect(await ui.find({ text: /貪食蛇/, in: 'arcade' })).toBeDefined()
    await ui.unmount()
  })
})
