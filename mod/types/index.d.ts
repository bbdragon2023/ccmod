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

declare module 'claude-code' {
  interface PluginState {
    chatchat: {
      life: Life
      now: number
      theme: ThemeName
      best: Record<string, number>
    }
  }
}
