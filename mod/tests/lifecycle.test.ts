import { describe, expect, test } from 'claude-code/testing'
import { SNOOZE_MS, alertFor, formatElapsed, initialLife, isPaused, reduce } from '../hooks/lifecycle'

const working = reduce(initialLife, { type: 'turnStart', at: 1_000 })

describe('lifecycle', () => {
  test('turn start puts the session to work and times it', async () => {
    expect(working.phase).toBe('working')
    expect(working.turnStartedAt).toBe(1_000)
    expect(isPaused(working, 2_000)).toBe(false)
  })

  test('turn complete pauses the game and raises one done alert', async () => {
    const done = reduce(working, { type: 'turnComplete', at: 109_000, isAborted: false })
    expect(done.phase).toBe('needsYou')
    expect(done.lastDurationMs).toBe(108_000)
    expect(isPaused(done, 110_000)).toBe(true)
    expect(alertFor(working, done)).toBe('done')
    // A second completion changes nothing, so it alerts nothing.
    const again = reduce(done, { type: 'turnComplete', at: 120_000, isAborted: false })
    expect(alertFor(done, again)).toBe(null)
  })

  test('an aborted turn goes idle without an alert', async () => {
    const aborted = reduce(working, { type: 'turnComplete', at: 5_000, isAborted: true })
    expect(aborted.phase).toBe('idle')
    expect(alertFor(working, aborted)).toBe(null)
  })

  test('a completion while idle is ignored', async () => {
    expect(reduce(initialLife, { type: 'turnComplete', at: 5_000, isAborted: false })).toBe(initialLife)
  })

  test('permission asks pause hard and settle back to working', async () => {
    const asking = reduce(working, { type: 'needsInput' })
    expect(asking.phase).toBe('needsPermission')
    expect(alertFor(working, asking)).toBe('permission')
    expect(isPaused(asking, 2_000)).toBe(true)
    // No snooze while a dialog waits.
    expect(reduce(asking, { type: 'snooze', at: 2_000 })).toBe(asking)
    expect(reduce(asking, { type: 'inputSettled' }).phase).toBe('working')
  })

  test('snooze resumes play for 30 s, once per finished turn', async () => {
    const done = reduce(working, { type: 'turnComplete', at: 10_000, isAborted: false })
    const snoozed = reduce(done, { type: 'snooze', at: 11_000 })
    expect(isPaused(snoozed, 11_000 + SNOOZE_MS - 1)).toBe(false)
    expect(isPaused(snoozed, 11_000 + SNOOZE_MS)).toBe(true)
    expect(reduce(snoozed, { type: 'snooze', at: 50_000 })).toBe(snoozed)
    // The next turn earns a fresh snooze.
    const nextTurn = reduce(snoozed, { type: 'turnStart', at: 60_000 })
    expect(nextTurn.hasSnoozed).toBe(false)
  })

  test('the offer shows once after the delay and stays dismissed', async () => {
    const shown = reduce(working, { type: 'offerDue' })
    expect(shown.offer).toBe('shown')
    const dismissed = reduce(shown, { type: 'offerDismissed' })
    expect(reduce(dismissed, { type: 'offerDue' }).offer).toBe('dismissed')
    expect(reduce(initialLife, { type: 'offerDue' }).offer).toBe('hidden')
  })

  test('going back to the prompt clears a finished turn', async () => {
    const done = reduce(working, { type: 'turnComplete', at: 10_000, isAborted: false })
    const back = reduce(done, { type: 'back' })
    expect(back.phase).toBe('idle')
    expect(back.lastDurationMs).toBe(9_000)
    expect(reduce(working, { type: 'back' })).toBe(working)
  })

  test('elapsed time reads as m:ss', async () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(108_400)).toBe('1:48')
    expect(formatElapsed(-5)).toBe('0:00')
  })
})
