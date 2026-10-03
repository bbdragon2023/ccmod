export type Phase = 'idle' | 'working' | 'needsYou' | 'needsPermission'

export type Offer = 'hidden' | 'shown' | 'dismissed'

export type Life = {
  phase: Phase
  turnStartedAt: number | null
  lastDurationMs: number | null
  snoozeUntil: number | null
  hasSnoozed: boolean
  offer: Offer
}

export type ThemeName = 'studio' | 'riso' | 'pocket'

export type GameId = 'snake' | 'merge' | 'mines'

export type ChatStatus = 'off' | 'unconfigured' | 'starting' | 'online' | 'reconnecting' | 'missing' | 'error'

export type FriendState = 'online' | 'waiting' | 'focus'

export type Friend = { id: string; nick: string; state: FriendState }

export type ChatMsg = { id: string; from: string; fromId: string; text: string; at: number; isMine: boolean }

export type Room = { code: string; name: string; url: string }

export type Chat = {
  status: ChatStatus
  room: Room | null
  myId: string | null
  messages: ChatMsg[]
  members: Friend[]
  unread: number
  attempt: number
  note: string | null
}

export type Tab = 'game' | 'chat'

declare module 'claude-code' {
  interface PluginState {
    chatchat: {
      life: Life
      now: number
      theme: ThemeName
      best: Record<string, number>
      chat: Chat
      tab: Tab
    }
  }
}
