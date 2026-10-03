// Daily cost ledger, one store key per local day: { [sessionId]: usd }.
export type Ledger = Record<string, number>

export const LEDGER_PREFIX = 'ledger:'
export const KEEP_DAYS = 7

export function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${LEDGER_PREFIX}${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// A session's figure is its running total, so it replaces rather than adds.
export function record(ledger: Ledger, sessionId: string, usd: number): Ledger {
  return { ...ledger, [sessionId]: usd }
}

export function total(ledger: Ledger): number {
  return Object.values(ledger).reduce((sum, usd) => sum + (Number.isFinite(usd) ? usd : 0), 0)
}

export function staleKeys(keys: readonly string[], now: number): string[] {
  const keep = new Set(Array.from({ length: KEEP_DAYS }, (_, i) => dayKey(now - i * 86_400_000)))
  return keys.filter(key => key.startsWith(LEDGER_PREFIX) && !keep.has(key))
}

export function asLedger(value: unknown): Ledger {
  if (!value || typeof value !== 'object') return {}
  const out: Ledger = {}
  for (const [key, usd] of Object.entries(value)) if (typeof usd === 'number') out[key] = usd
  return out
}
