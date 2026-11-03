import { en, type Messages } from './en'

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type MessageKey = Leaves<Messages>

const messages: Messages = en

/** Translate a dotted key with optional `{placeholders}`. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const value = key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], messages)
  let text = typeof value === 'string' ? value : key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v))
  }
  return text
}
