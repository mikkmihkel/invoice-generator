import type { UiLanguage } from '../../domain'
import { et } from './et'
import { en } from './en'

export type MessageKey = keyof typeof et
export type Dictionary = Record<MessageKey, string>
export type TParams = Record<string, string | number>
export type Translate = (key: MessageKey, params?: TParams) => string

export const dictionaries: Record<UiLanguage, Dictionary> = { et, en }

export function translate(lang: UiLanguage, key: MessageKey, params?: TParams): string {
  const s = dictionaries[lang]?.[key] ?? et[key] ?? key
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

export function makeT(lang: UiLanguage): Translate {
  return (key, params) => translate(lang, key, params)
}

/** Pick the UI-language variant of a `{ et, en }` message object. */
export function pick(msg: { et: string; en: string } | undefined, lang: UiLanguage): string {
  if (!msg) return ''
  return msg[lang] || msg.et || msg.en
}
