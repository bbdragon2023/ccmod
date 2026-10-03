// Shared contract for the chatchat bridge (run by Bun, zero dependencies):
// stdout events to the mod, and the wire format between bridges via the relay.
// Bump PROTOCOL when either changes.
export const PROTOCOL = 1

export type PresenceState = 'online' | 'waiting' | 'focus'

export type Member = { id: string; nick: string; state: PresenceState }

export type ChatMessage = { id: string; from: string; fromId: string; text: string; at: number }

// Bridge -> mod, one JSON object per stdout line.
export type BridgeEvent =
  | { v: number; t: 'ready' }
  | { v: number; t: 'status'; status: 'online' | 'reconnecting'; attempt?: number }
  | { v: number; t: 'msg'; msg: ChatMessage }
  | { v: number; t: 'members'; members: Member[] }
  | { v: number; t: 'error'; message: string }
  | { v: number; t: 'hosting'; port: number; urls: string[] } // relay-server only

// Bridge <-> relay.
export type WireMessage =
  | { kind: 'hello'; member: Member } // client -> relay, first frame
  | { kind: 'presence'; member: Member } // client -> relay
  | { kind: 'msg'; msg: ChatMessage } // both ways
  | { kind: 'members'; members: Member[] } // relay -> clients

export const MAX_TEXT = 500
export const MAX_NICK = 24
export const MAX_FRAME = 4096

// Strips terminal escape sequences and control characters, collapses whitespace, caps length.
export function sanitize(text: string, max = MAX_TEXT): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export function line(e: Record<string, unknown> & { t: BridgeEvent['t'] }): string {
  return JSON.stringify({ v: PROTOCOL, ...e }) + '\n'
}

export function parseWire(raw: string): WireMessage | null {
  if (raw.length > MAX_FRAME) return null
  try {
    const value = JSON.parse(raw) as { kind?: unknown }
    const kind = value?.kind
    return kind === 'hello' || kind === 'presence' || kind === 'msg' || kind === 'members' ? (value as WireMessage) : null
  } catch {
    return null
  }
}

export function cleanMember(member: Partial<Member> | undefined): Member | null {
  if (!member || typeof member.id !== 'string' || !member.id) return null
  const state: PresenceState = member.state === 'waiting' || member.state === 'focus' ? member.state : 'online'
  return { id: member.id.slice(0, 64), nick: sanitize(String(member.nick ?? ''), MAX_NICK) || '匿名', state }
}

export function cleanMessage(msg: Partial<ChatMessage> | undefined): ChatMessage | null {
  if (!msg) return null
  const text = sanitize(String(msg.text ?? ''))
  if (!text || typeof msg.id !== 'string') return null
  return {
    id: msg.id.slice(0, 64),
    from: sanitize(String(msg.from ?? ''), MAX_NICK) || '匿名',
    fromId: String(msg.fromId ?? '').slice(0, 64),
    text,
    at: typeof msg.at === 'number' && Number.isFinite(msg.at) ? msg.at : Date.now(),
  }
}
