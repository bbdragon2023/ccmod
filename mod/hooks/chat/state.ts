import type { Chat, ChatMsg, Friend, Phase, Room } from '../../types'

export const MAX_MESSAGES = 200
export const PROTOCOL = 1

export const initialChat: Chat = {
  status: 'off',
  room: null,
  myId: null,
  messages: [],
  members: [],
  unread: 0,
  attempt: 0,
  note: null,
}

export type ChatEvent =
  | { type: 'starting'; room: Room; myId: string }
  | { type: 'bridge'; event: unknown }
  | { type: 'sent'; msg: Omit<ChatMsg, 'isMine'> }
  | { type: 'stopped'; status: 'off' | 'missing' | 'error' | 'unconfigured'; note?: string }
  | { type: 'viewed' }

// `isViewing`: the chat tab is on screen, so new messages are already read.
export function reduceChat(chat: Chat, event: ChatEvent, isViewing: boolean): Chat {
  switch (event.type) {
    case 'starting':
      return { ...initialChat, status: 'starting', room: event.room, myId: event.myId, messages: chat.room?.code === event.room.code ? chat.messages : [] }
    case 'sent':
      return { ...chat, messages: [...chat.messages, { ...event.msg, isMine: true }].slice(-MAX_MESSAGES) }
    case 'stopped':
      return { ...chat, status: event.status, members: [], note: event.note ?? null, room: event.status === 'off' ? null : chat.room }
    case 'viewed':
      return chat.unread === 0 ? chat : { ...chat, unread: 0 }
    case 'bridge':
      return onBridgeEvent(chat, event.event, isViewing)
  }
}

function onBridgeEvent(chat: Chat, raw: unknown, isViewing: boolean): Chat {
  if (!raw || typeof raw !== 'object') return chat
  const e = raw as { v?: number; t?: string; status?: string; attempt?: number; msg?: ChatMsg; members?: Friend[]; message?: string }
  if (e.v !== PROTOCOL) return { ...chat, status: 'error', note: '橋接程式版本不符，請更新 chatchat。' }
  switch (e.t) {
    case 'status':
      return e.status === 'online'
        ? { ...chat, status: 'online', attempt: 0, note: null }
        : { ...chat, status: 'reconnecting', attempt: e.attempt ?? chat.attempt + 1 }
    case 'members':
      return Array.isArray(e.members) ? { ...chat, members: e.members.filter(m => m && typeof m.id === 'string') } : chat
    case 'msg': {
      if (!e.msg || typeof e.msg.text !== 'string' || chat.messages.some(m => m.id === e.msg!.id)) return chat
      const msg: ChatMsg = { ...e.msg, isMine: e.msg.fromId === chat.myId }
      return {
        ...chat,
        messages: [...chat.messages, msg].slice(-MAX_MESSAGES),
        unread: isViewing || msg.isMine ? chat.unread : chat.unread + 1,
      }
    }
    case 'error':
      return { ...chat, note: typeof e.message === 'string' ? e.message.slice(0, 200) : chat.note }
    default:
      return chat
  }
}

// Bridge stdout arrives in arbitrary pieces; keep the unfinished tail.
export function splitLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (buffer + chunk).split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.map(part => part.trim()).filter(Boolean), rest }
}

// No 0/O, 1/I/L: codes get read aloud and retyped.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function makeCode(random: Uint8Array): string {
  const chars = Array.from(random.slice(0, 12), byte => CODE_ALPHABET[byte % CODE_ALPHABET.length])
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map(group => group.join('')).join('-')
}

export function normalizeCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, '')
  if (raw.length !== 12 || [...raw].some(ch => !CODE_ALPHABET.includes(ch))) return null
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}

// The relay only ever sees this hash, never the invite code.
export async function roomIdOf(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`chatchat:${code}`))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

export function isRelayUrl(url: string): boolean {
  return /^wss?:\/\/[^\s/]+(:\d+)?\/?$/.test(url)
}

export function presenceOf(phase: Phase): 'online' | 'waiting' {
  return phase === 'idle' ? 'online' : 'waiting'
}

export function stateLabel(state: Friend['state']): string {
  return state === 'waiting' ? '等 Claude 中' : state === 'focus' ? '專注中' : '在線上'
}

// Stable colour per friend, from the theme's friend palette.
export function friendColor(id: string, palette: readonly string[]): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return palette[hash % palette.length] ?? palette[0] ?? '#ffffff'
}
