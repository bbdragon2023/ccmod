import type { ThemeName } from '../../types'

// Semantic roles only: views read these, never raw colours.
export type Theme = {
  name: ThemeName
  label: string
  surface: string
  ink: string
  muted: string
  accent: string
  edge: string
  attention: string
  danger: string
  friends: string[]
  border: 'round' | 'single' | 'bold' | 'double'
  mark: string // chatchat's glyph in the band and statusline
  doneTitle: string
  doneArt: string[] // optional big lettering above the pause dialog
  permissionTitle: string
  snake: { head: string; body: string; food: string; empty: string }
  sound: { done: string; permission: string }
}

const studio: Theme = {
  name: 'studio',
  label: 'Studio',
  surface: '#16151f',
  ink: '#e9e6f5',
  muted: '#8d88aa',
  accent: '#b8b2f0',
  edge: '#a59fd0',
  attention: '#ffb38a',
  danger: '#f07b6b',
  friends: ['#ffc6ff', '#a0c4ff', '#caffbf', '#ffd6a5'],
  border: 'round',
  mark: '◆',
  doneTitle: '◉ Claude 做完了',
  doneArt: [],
  permissionTitle: '◉ Claude 在等你授權',
  snake: { head: '██', body: '▓▓', food: '◉ ', empty: '  ' },
  sound: { done: 'sounds/studio-done.wav', permission: 'sounds/studio-ask.wav' },
}

const riso: Theme = {
  name: 'riso',
  label: 'Riso',
  surface: '#f2ede1',
  ink: '#1d1b2e',
  muted: '#5c5870',
  accent: '#0078bf',
  edge: '#ff48b0',
  attention: '#ff48b0',
  danger: '#e8402e',
  friends: ['#ff48b0', '#0078bf', '#b39800', '#00a95c'],
  border: 'bold',
  mark: '★',
  doneTitle: '★ DONE! Claude 做完了',
  doneArt: ['█▀▀▄ █▀▀█ █▄ █ █▀▀ █', '█  █ █  █ █ ▀█ █▀▀ ▀', '▀▀▀  ▀▀▀▀ ▀  ▀ ▀▀▀ ▀'],
  permissionTitle: '★ STOP! Claude 在等你授權',
  snake: { head: '██', body: '▒▒', food: '★ ', empty: '  ' },
  sound: { done: 'sounds/riso-done.wav', permission: 'sounds/riso-ask.wav' },
}

const pocket: Theme = {
  name: 'pocket',
  label: 'Pocket',
  surface: '#9bbc0f',
  ink: '#0f380f',
  muted: '#306230',
  accent: '#0f380f',
  edge: '#306230',
  attention: '#0f380f',
  danger: '#0f380f',
  friends: ['#0f380f', '#306230', '#0f380f', '#306230'],
  border: 'double',
  mark: '▶',
  doneTitle: 'CLAUDE：做完了！ ▼',
  doneArt: [],
  permissionTitle: 'CLAUDE：要你授權！ ▼',
  snake: { head: '██', body: '▓▓', food: '○ ', empty: '  ' },
  sound: { done: 'sounds/pocket-done.wav', permission: 'sounds/pocket-ask.wav' },
}

export const THEMES: Record<ThemeName, Theme> = { studio, riso, pocket }
export const THEME_NAMES: ThemeName[] = ['studio', 'riso', 'pocket']
export const DEFAULT_THEME: ThemeName = 'studio'

export function themeOf(name: unknown): Theme {
  return typeof name === 'string' && name in THEMES ? THEMES[name as ThemeName] : THEMES[DEFAULT_THEME]
}

export function isThemeName(name: unknown): name is ThemeName {
  return typeof name === 'string' && name in THEMES
}

// WCAG relative-luminance contrast, used by the theme tests.
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const channel = (c: number) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
