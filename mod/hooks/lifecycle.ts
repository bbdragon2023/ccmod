import type { Life } from '../types'

// How long a "play 30 more seconds" lasts after Claude finished.
export const SNOOZE_MS = 30_000
// How long after a turn starts before the band offers a game.
export const OFFER_DELAY_MS = 5_000

export const initialLife: Life = {
  phase: 'idle',
  turnStartedAt: null,
  lastDurationMs: null,
  snoozeUntil: null,
  hasSnoozed: false,
  offer: 'hidden',
}

export type LifeEvent =
  | { type: 'turnStart'; at: number }
  | { type: 'turnComplete'; at: number; isAborted: boolean }
  | { type: 'needsInput' } // a permission dialog or a question for the person
  | { type: 'inputSettled' }
  | { type: 'offerDue' }
  | { type: 'offerDismissed' }
  | { type: 'snooze'; at: number }
  | { type: 'back' } // the person went back to the prompt

export type Alert = 'done' | 'permission' | null

export function reduce(life: Life, event: LifeEvent): Life {
  switch (event.type) {
    case 'turnStart':
      return { ...initialLife, phase: 'working', turnStartedAt: event.at }
    case 'turnComplete': {
      if (life.phase === 'idle') return life
      const lastDurationMs =
        life.turnStartedAt === null ? null : Math.max(0, event.at - life.turnStartedAt)
      if (event.isAborted) return { ...initialLife, lastDurationMs }
      return { ...life, phase: 'needsYou', lastDurationMs, offer: 'hidden', snoozeUntil: null }
    }
    case 'needsInput':
      return life.phase === 'working' ? { ...life, phase: 'needsPermission' } : life
    case 'inputSettled':
      return life.phase === 'needsPermission' ? { ...life, phase: 'working' } : life
    case 'offerDue':
      return life.phase === 'working' && life.offer === 'hidden' ? { ...life, offer: 'shown' } : life
    case 'offerDismissed':
      return { ...life, offer: 'dismissed' }
    case 'snooze':
      // One snooze per finished turn, and never while a dialog waits.
      if (life.phase !== 'needsYou' || life.hasSnoozed) return life
      return { ...life, snoozeUntil: event.at + SNOOZE_MS, hasSnoozed: true }
    case 'back':
      return life.phase === 'needsYou' ? { ...initialLife, lastDurationMs: life.lastDurationMs } : life
  }
}

// Games run only while Claude works, or inside an unexpired snooze.
export function isPaused(life: Life, now: number): boolean {
  if (life.phase === 'needsPermission') return true
  if (life.phase === 'needsYou') return life.snoozeUntil === null || now >= life.snoozeUntil
  return false
}

export function alertFor(before: Life, after: Life): Alert {
  if (before.phase === after.phase) return null
  if (after.phase === 'needsPermission') return 'permission'
  if (after.phase === 'needsYou') return 'done'
  return null
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
