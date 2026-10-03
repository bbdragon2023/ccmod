import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_OPTIONS, buildLine, limitMarker, prettyModel, timeLeft, type StatusData, type StatusOptions } from '../hooks/statusline/segments'
import { asLedger, dayKey, record, staleKeys, total } from '../hooks/statusline/ledger'
import { THEMES, THEME_NAMES, contrast, themeOf } from '../hooks/theme/tokens'

const NOW = Date.parse('2026-10-03T12:00:00Z')

const data: StatusData = {
  now: NOW,
  hasOwnStatusLine: false,
  dir: 'brand-site',
  bun: '1.2.21',
  branch: 'main',
  isDirty: true,
  model: 'Opus 5.5',
  costUsd: 0.84,
  dailyUsd: 6.2,
  fiveHour: { percentUsed: 50, resetsAt: '2026-10-03T13:12:00Z' },
  chatchat: '◆ Claude 0:42',
}

const full: StatusOptions = { ...DEFAULT_OPTIONS, mode: 'full' }

describe('statusline', () => {
  test('full mode shows the same segments as statusline-cost.sh', async () => {
    expect(buildLine(data, full)).toBe(
      '📁 brand-site | 🌿 main* | 🤖 Opus 5.5 | 💸 $0.84 | 💰 $6.20/day | ⏰ 1h 12m left | ◆ Claude 0:42',
    )
  })

  test('auto mode with an own statusLine shows only the chatchat segment', async () => {
    expect(buildLine({ ...data, hasOwnStatusLine: true }, DEFAULT_OPTIONS)).toBe('◆ Claude 0:42')
    expect(buildLine(data, DEFAULT_OPTIONS)).toContain('📁 brand-site')
  })

  test('missing data drops its segment without an empty separator', async () => {
    const line = buildLine({ now: NOW, hasOwnStatusLine: false, model: 'Opus 5.5' }, full)
    expect(line).toBe('🤖 Opus 5.5')
  })

  test('off mode and all-off segments clear the line', async () => {
    expect(buildLine(data, { ...full, mode: 'off' })).toBe(undefined)
    const none = Object.fromEntries(Object.keys(full.segments).map(k => [k, false])) as StatusOptions['segments']
    expect(buildLine(data, { mode: 'full', segments: none })).toBe(undefined)
  })

  test('the limit gets a marker at 70% and 90%', async () => {
    expect(limitMarker(69)).toBe('')
    expect(limitMarker(72)).toBe('⚠ ')
    expect(limitMarker(95)).toBe('🔴 ')
    expect(buildLine({ ...data, fiveHour: { percentUsed: 95, resetsAt: '2026-10-03T12:09:00Z' } }, full)).toContain('⏰ 🔴 0h 9m left')
  })

  test('time left handles missing and past resets', async () => {
    expect(timeLeft(undefined, NOW)).toBe(undefined)
    expect(timeLeft('not a date', NOW)).toBe(undefined)
    expect(timeLeft('2026-10-03T11:00:00Z', NOW)).toBe('0h 0m left')
  })

  test('model ids read as family and version', async () => {
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(prettyModel('gpt-x')).toBe('gpt-x')
  })
})

describe('ledger', () => {
  test('a session counts once however often it updates', async () => {
    let ledger = record({}, 'a', 0.5)
    ledger = record(ledger, 'a', 0.8)
    ledger = record(ledger, 'b', 1.2)
    expect(Math.round(total(ledger) * 100)).toBe(200)
  })

  test('each local day has its own key and old days are pruned', async () => {
    const today = dayKey(NOW)
    const old = dayKey(NOW - 9 * 86_400_000)
    expect(today).not.toBe(dayKey(NOW + 86_400_000))
    expect(staleKeys([today, old, 'theme', 'best'], NOW)).toEqual([old])
  })

  test('a corrupt stored value reads as an empty ledger', async () => {
    expect(asLedger('nope')).toEqual({})
    expect(asLedger({ a: 1, b: 'x' })).toEqual({ a: 1 })
  })
})

describe('themes', () => {
  test('an unknown theme falls back to Studio', async () => {
    expect(themeOf('neon').name).toBe('studio')
    expect(themeOf(undefined).name).toBe('studio')
  })

  test('every theme keeps body text readable (4.5:1)', async () => {
    for (const name of THEME_NAMES) {
      const theme = THEMES[name]
      expect(contrast(theme.ink, theme.surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme.accent, theme.surface)).toBeGreaterThanOrEqual(3)
    }
  })
})
