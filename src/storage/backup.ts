import type { BackupFile } from '../domain/types'

/** Format id written into every backup file. It stays the same across product renames, so all versions can read each other's files. */
export const BACKUP_APP = 'invoice-generator'
export const BACKUP_VERSION = 2
/** Oldest backup format that can still be read. */
export const BACKUP_MIN_VERSION = 1

/** Thrown when a file is not a valid backup of this app. Carries a bilingual message. */
export class BackupFormatError extends Error {
  readonly messages: { et: string; en: string }
  constructor(et: string, en: string) {
    super(en)
    this.name = 'BackupFormatError'
    this.messages = { et, en }
  }
}

type Text = { et: string; en: string }

const STATUSES = ['draft', 'issued', 'paid', 'cancelled']
const INVOICE_TYPES = ['invoice', 'credit-note', 'prepayment', 'quote']
const NUMBERING_RESETS = ['never', 'yearly', 'monthly', 'daily']
const RECURRENCE_INTERVALS = ['monthly', 'quarterly', 'yearly']
const EVENT_KINDS = ['sent', 'reminder']
/** Widest zero padding of a document number (the numbering editor allows the same). */
const MAX_NUMBER_PADDING = 10
/** Counter keys of a resetting number series: '2026', '2026-10' or '2026-10-15'. */
const COUNTER_KEY = /^\d{4}(-\d{2}(-\d{2})?)?$/
const LANGUAGES = ['et', 'en', 'et-en']
const UI_LANGUAGES = ['et', 'en']
const CLIENT_KINDS = ['company', 'person']
const COLOR_MODES = ['mono', 'accent', 'duo']
const VAT_SCHEMES = [
  'not-registered',
  'domestic',
  'eu-reverse-charge',
  'eu-goods',
  'export',
  'non-eu-services',
  'exempt',
  'domestic-reverse-charge',
]

/** Size limits: far above real use, low enough to keep a hostile file from freezing the tab. */
export const BACKUP_LIMITS = {
  /** Characters of JSON text accepted by parseBackup. */
  textLength: 200 * 1024 * 1024,
  records: 50_000,
  linesPerInvoice: 10_000,
  stringLength: 1024 * 1024,
  logoDataUrlLength: 2 * 1024 * 1024,
  /** Free-text rows before/after the invoice lines (`textBefore` / `textAfter`). */
  textRows: 100,
  /** Period counters of one number series (a daily series uses one per day). */
  numberingCounters: 20_000,
  /** Automatic backup versions kept in Drive. */
  keepVersions: 1000,
}

const ADDRESS_FIELDS = [
  ['street', 'tänav', 'street'],
  ['city', 'linn', 'city'],
  ['postalCode', 'postiindeks', 'postal code'],
  ['county', 'maakond', 'county'],
  ['country', 'riik', 'country'],
]
const PARTY_FIELDS = [
  ['registryCode', 'registrikood', 'registry code'],
  ['personalCode', 'isikukood', 'personal code'],
  ['vatNumber', 'KMKR number', 'VAT number'],
  ['email', 'e-posti aadress', 'email'],
  ['phone', 'telefon', 'phone'],
]

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Only embedded PNG/JPEG logos: a remote URL would leak the user's IP when rendered. */
export const LOGO_DATA_URL = /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/
/** Only plain hex colours: anything else (e.g. url(...)) would reach CSS custom properties. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
export const GOOGLE_CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const absent = (v: unknown) => v === undefined || v === null

function isValidDate(v: unknown): boolean {
  if (typeof v !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

/**
 * Walk the whole parsed value (iteratively) and reject prototype-pollution keys and oversized strings.
 * `path` in messages is a dot path such as "invoices.3.seller".
 */
function checkTree(root: unknown) {
  const stack: { value: unknown; path: string; key: string }[] = [{ value: root, path: '', key: '' }]
  while (stack.length) {
    const { value, path, key } = stack.pop()!
    if (typeof value === 'string') {
      const max = key === 'logoDataUrl' ? BACKUP_LIMITS.logoDataUrlLength : BACKUP_LIMITS.stringLength
      if (value.length > max) {
        throw new BackupFormatError(`Varukoopias on liiga pikk tekstiväli (${path}).`, `The backup contains a text field that is too long (${path}).`)
      }
      continue
    }
    if (typeof value !== 'object' || value === null) continue
    for (const k of Object.keys(value)) {
      const childPath = path ? `${path}.${k}` : k
      if (FORBIDDEN_KEYS.has(k)) {
        throw new BackupFormatError(
          `Varukoopias on keelatud väli „${k}“ (${childPath}). Fail võib olla pahatahtlikult muudetud.`,
          `The backup contains the forbidden key "${k}" (${childPath}). The file may have been tampered with.`,
        )
      }
      stack.push({ value: (value as Record<string, unknown>)[k], path: childPath, key: k })
    }
  }
}

// Field problems: "puudub arve kuupäev" / "missing issue date", "vigane olek" / "invalid status".
const missing = (f: Text): Text => ({ et: `puudub ${f.et}`, en: `missing ${f.en}` })
const invalid = (f: Text): Text => ({ et: `vigane ${f.et}`, en: `invalid ${f.en}` })

/** Collects the first problem of a record. Each check returns false once a problem was found. */
class RecordCheck {
  problem: Text | null = null
  private readonly r: Record<string, unknown>
  constructor(r: Record<string, unknown>) {
    this.r = r
  }

  private fail(p: Text) {
    this.problem ??= p
    return false
  }

  private check(value: unknown, field: Text, ok: (v: unknown) => boolean, required: boolean) {
    if (this.problem) return false
    if (absent(value)) return required ? this.fail(missing(field)) : true
    return ok(value) ? true : this.fail(invalid(field))
  }

  /** Required string; `allowEmpty` = '' counts as present. */
  str(key: string, field: Text, allowEmpty = false, from: Record<string, unknown> = this.r) {
    const v = from[key]
    if (v === '' && !allowEmpty) return this.fail(missing(field))
    return this.check(v, field, (x) => typeof x === 'string', true)
  }
  optStr(key: string, field: Text, from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, (x) => typeof x === 'string', false)
  }
  oneOf(key: string, field: Text, values: string[], from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, (x) => typeof x === 'string' && values.includes(x), true)
  }
  optOneOf(key: string, field: Text, values: string[], from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, (x) => typeof x === 'string' && values.includes(x), false)
  }
  date(key: string, field: Text, from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, isValidDate, true)
  }
  num(key: string, field: Text, from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, (x) => typeof x === 'number' && Number.isFinite(x), true)
  }
  optNum(key: string, field: Text, from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, (x) => typeof x === 'number' && Number.isFinite(x), false)
  }
  /** Optional string that must match `pattern` (used for values that end up in URLs or CSS). */
  optMatch(key: string, field: Text, pattern: RegExp, from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, (x) => typeof x === 'string' && (x === '' || pattern.test(x)), false)
  }
  optBool(key: string, field: Text, from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, (x) => typeof x === 'boolean', false)
  }
  bool(key: string, field: Text, from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, (x) => typeof x === 'boolean', true)
  }
  /** Required whole number within [min, max]. */
  int(key: string, field: Text, min: number, max: number, from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, (x) => typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= max, true)
  }
  optDate(key: string, field: Text, from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, isValidDate, false)
  }
  /** Required timestamp that Date.parse understands. */
  time(key: string, field: Text, from: Record<string, unknown> = this.r) {
    return this.check(from[key], field, (x) => typeof x === 'string' && !Number.isNaN(Date.parse(x)), true)
  }

  /** A number series (`CompanyProfile.numbering` / `quoteNumbering`). */
  numbering(n: Record<string, unknown>, label: Text) {
    const f = (et: string, en: string): Text => ({ et: `${label.et}: ${et}`, en: `${label.en}: ${en}` })
    this.int('nextNumber', f('järgmine number', 'next number'), 1, Number.MAX_SAFE_INTEGER, n)
    this.int('padding', f('numbri pikkus', 'number padding'), 0, MAX_NUMBER_PADDING, n)
    this.optStr('prefix', f('numbri eesliide', 'number prefix'), n)
    this.optOneOf('reset', f('numbri uuesti alustamine', 'numbering reset'), NUMBERING_RESETS, n)
    const counters = n.counters
    if (this.problem || absent(counters)) return !this.problem
    if (!isObject(counters)) return this.fail(invalid(f('perioodide loendurid', 'period counters')))
    const keys = Object.keys(counters)
    if (keys.length > BACKUP_LIMITS.numberingCounters) {
      return this.fail({ et: `liiga palju kirjeid: ${f('perioodide loendurid', '').et}`, en: `too many entries: ${f('', 'period counters').en}` })
    }
    for (const k of keys) {
      const v = counters[k]
      if (!COUNTER_KEY.test(k) || typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
        return this.fail(invalid(f(`perioodi ${k} loendur`, `counter of period ${k}`)))
      }
    }
    return true
  }
  /** Optional list of strings (each within `BACKUP_LIMITS.stringLength`, checked by `checkTree`). */
  optStrList(key: string, field: Text, from: Record<string, unknown> = this.r, max = BACKUP_LIMITS.textRows) {
    const v = from[key]
    if (this.problem || absent(v)) return !this.problem
    if (Array.isArray(v) && v.length > max) return this.fail({ et: `liiga palju kirjeid: ${field.et}`, en: `too many entries: ${field.en}` })
    return this.check(v, field, (x) => Array.isArray(x) && x.every((item) => typeof item === 'string'), false)
  }
  obj(key: string, field: Text, from: Record<string, unknown> = this.r): Record<string, unknown> | null {
    return this.check(from[key], field, isObject, true) ? (from[key] as Record<string, unknown>) : null
  }
  arr(key: string, field: Text, from: Record<string, unknown> = this.r, max = BACKUP_LIMITS.records): unknown[] | null {
    const ok = this.check(from[key], field, Array.isArray, true)
    if (!ok) return null
    const list = from[key] as unknown[]
    if (list.length > max) {
      this.fail({ et: `liiga palju kirjeid: ${field.et}`, en: `too many entries: ${field.en}` })
      return null
    }
    return list
  }

  address(key: string, field: Text, from: Record<string, unknown> = this.r) {
    const a = this.obj(key, field, from)
    if (!a) return false
    for (const [k, et, en] of ADDRESS_FIELDS) {
      this.optStr(k, { et: `${field.et} (${et})`, en: `${field.en} (${en})` }, a)
    }
    return !this.problem
  }

  bankAccounts(key: string, field: Text, from: Record<string, unknown> = this.r) {
    const list = this.arr(key, field, from, 100)
    if (!list) return false
    list.forEach((acc, i) => {
      const f = { et: `${field.et} (${i + 1}. konto)`, en: `${field.en} (account ${i + 1})` }
      if (this.problem) return
      if (!isObject(acc)) this.fail(invalid(f))
      else this.str('iban', { et: `${f.et} IBAN`, en: `${f.en} IBAN` }, true, acc)
    })
    return !this.problem
  }

  /** Party fields shared by profile, clients and invoice buyer/seller snapshots. */
  party(from: Record<string, unknown>, label: Text) {
    this.str('name', { et: `${label.et} nimi`, en: `${label.en} name` }, true, from)
    this.address('address', { et: `${label.et} aadress`, en: `${label.en} address` }, from)
    for (const [k, et, en] of PARTY_FIELDS) {
      this.optStr(k, { et: `${label.et} ${et}`, en: `${label.en} ${en}` }, from)
    }
    return !this.problem
  }
}

function checkInvoice(r: Record<string, unknown>): Text | null {
  const c = new RecordCheck(r)
  c.str('number', { et: 'arve number', en: 'invoice number' }, true)
  c.oneOf('type', { et: 'arve liik', en: 'invoice type' }, INVOICE_TYPES)
  c.oneOf('status', { et: 'arve olek', en: 'status' }, STATUSES)
  c.date('issueDate', { et: 'arve kuupäev', en: 'issue date' })
  c.date('dueDate', { et: 'maksetähtaeg', en: 'due date' })
  c.str('currency', { et: 'valuuta', en: 'currency' })
  c.oneOf('language', { et: 'arve keel', en: 'invoice language' }, LANGUAGES)
  c.str('templateId', { et: 'kujundus', en: 'template' })
  c.oneOf('vatScheme', { et: 'käibemaksurežiim', en: 'VAT scheme' }, VAT_SCHEMES)
  const seller = c.obj('seller', { et: 'müüja andmed', en: 'seller details' })
  if (seller) {
    c.party(seller, { et: 'müüja', en: 'seller' })
    c.bankAccounts('bankAccounts', { et: 'müüja pangakontod', en: 'seller bank accounts' }, seller)
  }
  const buyer = c.obj('buyer', { et: 'ostja andmed', en: 'buyer details' })
  if (buyer) c.party(buyer, { et: 'ostja', en: 'buyer' })
  const lines = c.arr('lines', { et: 'arveread', en: 'invoice lines' }, r, BACKUP_LIMITS.linesPerInvoice)
  lines?.forEach((line, i) => {
    const n = i + 1
    const f = (et: string, en: string): Text => ({ et: `${n}. rea ${et}`, en: `${en} on line ${n}` })
    if (!isObject(line)) {
      if (!c.problem) c.problem = invalid({ et: `${n}. arverida`, en: `invoice line ${n}` })
      return
    }
    c.str('id', f('ID', 'id'), true, line)
    c.str('description', f('kirjeldus', 'description'), true, line)
    c.str('unit', f('ühik', 'unit'), true, line)
    c.num('quantity', f('kogus', 'quantity'), line)
    c.num('unitPrice', f('ühikuhind', 'unit price'), line)
    c.num('vatRate', f('käibemaksumäär', 'VAT rate'), line)
    c.optNum('discountPercent', f('allahindlus', 'discount'), line)
  })
  const ids = c.arr('bankAccountIds', { et: 'valitud pangakontod', en: 'selected bank accounts' })
  if (ids && !ids.every((x) => typeof x === 'string')) c.problem ??= invalid({ et: 'valitud pangakontod', en: 'selected bank accounts' })
  c.optStr('createdAt', { et: 'loomise aeg', en: 'creation time' })
  c.optBool('paymentQr', { et: 'makse QR-kood', en: 'payment QR code' })
  c.optStrList('textBefore', { et: 'tekst enne arveridu', en: 'text before the invoice lines' })
  c.optStrList('textAfter', { et: 'tekst pärast arveridu', en: 'text after the invoice lines' })
  for (const [k, et, en] of [
    ['supplyDate', 'käibe kuupäev', 'supply date'],
    ['periodStart', 'perioodi algus', 'period start'],
    ['periodEnd', 'perioodi lõpp', 'period end'],
    ['paidAt', 'tasumise kuupäev', 'payment date'],
    ['issuedAt', 'väljastamise aeg', 'issue time'],
    ['reopenedAt', 'muutmiseks avamise aeg', 'reopening time'],
    ['referenceNumber', 'viitenumber', 'reference number'],
    ['notes', 'märkused', 'notes'],
    ['quoteAcceptedAt', 'pakkumise aktsepteerimise aeg', 'quote acceptance time'],
    ['convertedToInvoiceId', 'pakkumisest koostatud arve', 'invoice created from the quote'],
    ['convertedFromQuoteId', 'arve aluseks olev pakkumine', 'quote the invoice was created from'],
    ['recurringRuleId', 'korduvarve reegel', 'recurring rule'],
  ]) {
    c.optStr(k, { et, en })
  }
  c.optDate('validUntil', { et: 'pakkumise kehtivus', en: 'quote validity date' })
  c.optDate('reopenedIssueDate', { et: 'algne arve kuupäev', en: 'original issue date' })
  c.optMatch('accentColor', { et: 'värv', en: 'accent colour' }, HEX_COLOR)
  c.optMatch('secondaryColor', { et: 'lisavärv', en: 'secondary colour' }, HEX_COLOR)
  c.optOneOf('colorMode', { et: 'värvilahendus', en: 'colour mode' }, COLOR_MODES)
  if (seller) {
    c.optMatch('logoDataUrl', { et: 'müüja logo', en: 'seller logo' }, LOGO_DATA_URL, seller)
    c.optStr('website', { et: 'müüja veebileht', en: 'seller website' }, seller)
  }
  c.optNum('eurExchangeRate', { et: 'euro vahetuskurss', en: 'EUR exchange rate' })
  return c.problem
}

function checkClient(r: Record<string, unknown>): Text | null {
  const c = new RecordCheck(r)
  c.str('name', { et: 'nimi', en: 'name' }, true)
  c.oneOf('kind', { et: 'kliendi liik', en: 'client kind' }, CLIENT_KINDS)
  c.address('address', { et: 'aadress', en: 'address' })
  c.optStr('createdAt', { et: 'loomise aeg', en: 'creation time' })
  return c.problem
}

function checkProfile(r: Record<string, unknown>): Text | null {
  const c = new RecordCheck(r)
  c.str('name', { et: 'nimi', en: 'name' }, true)
  c.address('address', { et: 'aadress', en: 'address' })
  c.bankAccounts('bankAccounts', { et: 'pangakontod', en: 'bank accounts' })
  const d = c.obj('defaults', { et: 'arve vaikeväärtused', en: 'invoice defaults' })
  if (d) {
    c.num('paymentTermDays', { et: 'maksetähtaeg päevades', en: 'payment term' }, d)
    c.str('templateId', { et: 'arve kujundus', en: 'invoice template' }, false, d)
    c.str('accentColor', { et: 'arve värv', en: 'invoice accent colour' }, false, d)
    c.optMatch('accentColor', { et: 'arve värv', en: 'invoice accent colour' }, HEX_COLOR, d)
    c.optMatch('secondaryColor', { et: 'arve lisavärv', en: 'invoice secondary colour' }, HEX_COLOR, d)
    c.optOneOf('colorMode', { et: 'arve värvilahendus', en: 'invoice colour mode' }, COLOR_MODES, d)
    c.oneOf('language', { et: 'arve keel', en: 'invoice language' }, LANGUAGES, d)
    c.str('currency', { et: 'valuuta', en: 'currency' }, false, d)
    c.oneOf('vatScheme', { et: 'käibemaksurežiim', en: 'VAT scheme' }, VAT_SCHEMES, d)
    c.num('defaultVatRate', { et: 'vaikimisi käibemaksumäär', en: 'default VAT rate' }, d)
    c.str('defaultUnit', { et: 'vaikimisi ühik', en: 'default unit' }, true, d)
    c.optNum('lateInterestPercentPerDay', { et: 'viivis', en: 'late interest' }, d)
    c.optBool('paymentQr', { et: 'makse QR-kood', en: 'payment QR code' }, d)
    c.optStrList('textBefore', { et: 'vaikimisi tekst enne arveridu', en: 'default text before the invoice lines' }, d)
    c.optStrList('textAfter', { et: 'vaikimisi tekst pärast arveridu', en: 'default text after the invoice lines' }, d)
    c.str('emailSubject', { et: 'e-kirja teema', en: 'email subject' }, true, d)
    c.str('emailBody', { et: 'e-kirja sisu', en: 'email body' }, true, d)
    for (const [k, et, en] of [
      ['footerNote', 'jaluse tekst', 'footer note'],
      ['emailSubjectEn', 'ingliskeelse e-kirja teema', 'English email subject'],
      ['emailBodyEn', 'ingliskeelse e-kirja sisu', 'English email body'],
    ]) {
      c.optStr(k, { et, en }, d)
    }
  }
  const numbering = c.obj('numbering', { et: 'arvete numeratsioon', en: 'invoice numbering' })
  if (numbering) {
    c.int('nextNumber', { et: 'järgmine arve number', en: 'next invoice number' }, 1, Number.MAX_SAFE_INTEGER, numbering)
    c.int('padding', { et: 'numbri pikkus', en: 'number padding' }, 0, MAX_NUMBER_PADDING, numbering)
    c.optStr('prefix', { et: 'numbri eesliide', en: 'number prefix' }, numbering)
    c.numbering(numbering, { et: 'arvete numeratsioon', en: 'invoice numbering' })
  }
  if (!absent(r.quoteNumbering)) {
    const quote = c.obj('quoteNumbering', { et: 'hinnapakkumiste numeratsioon', en: 'quote numbering' })
    if (quote) c.numbering(quote, { et: 'hinnapakkumiste numeratsioon', en: 'quote numbering' })
  }
  c.optMatch('logoDataUrl', { et: 'logo', en: 'logo' }, LOGO_DATA_URL)
  c.optStr('website', { et: 'veebileht', en: 'website' })
  c.optStr('updatedAt', { et: 'muutmise aeg', en: 'modification time' })
  return c.problem
}

function checkSettings(r: Record<string, unknown>): Text | null {
  const c = new RecordCheck(r)
  c.optOneOf('uiLanguage', { et: 'kasutajaliidese keel', en: 'interface language' }, UI_LANGUAGES)
  c.optOneOf('theme', { et: 'välimus', en: 'theme' }, ['auto', 'light', 'dark'])
  c.optMatch('googleClientId', { et: 'Google’i kliendi ID', en: 'Google client ID' }, GOOGLE_CLIENT_ID)
  c.optStr('driveFolderName', { et: 'Drive’i kausta nimi', en: 'Drive folder name' })
  c.optBool('registryLiveLookup', { et: 'registri otsingu seade', en: 'registry lookup setting' })
  c.optStr('updatedAt', { et: 'muutmise aeg', en: 'modification time' })
  if (!absent(r.autoBackup)) {
    const a = c.obj('autoBackup', { et: 'automaatse varunduse seaded', en: 'automatic backup settings' })
    if (a) {
      c.bool('enabled', { et: 'automaatne varundus', en: 'automatic backup' }, a)
      c.bool('encrypt', { et: 'varukoopia krüpteerimine', en: 'backup encryption' }, a)
      c.int('keepVersions', { et: 'säilitatavate versioonide arv', en: 'number of versions to keep' }, 1, BACKUP_LIMITS.keepVersions, a)
      c.optStr('lastBackupAt', { et: 'viimase varunduse aeg', en: 'last backup time' }, a)
    }
  }
  return c.problem
}

function checkProduct(r: Record<string, unknown>): Text | null {
  const c = new RecordCheck(r)
  c.str('description', { et: 'kirjeldus', en: 'description' })
  c.str('unit', { et: 'ühik', en: 'unit' }, true)
  c.num('unitPrice', { et: 'ühikuhind', en: 'unit price' })
  c.optNum('vatRate', { et: 'käibemaksumäär', en: 'VAT rate' })
  c.optStr('createdAt', { et: 'loomise aeg', en: 'creation time' })
  return c.problem
}

function checkRecurringRule(r: Record<string, unknown>): Text | null {
  const c = new RecordCheck(r)
  c.str('sourceInvoiceId', { et: 'aluseks olev arve', en: 'source invoice' })
  c.oneOf('interval', { et: 'kordumise sagedus', en: 'interval' }, RECURRENCE_INTERVALS)
  c.date('nextDate', { et: 'järgmine kuupäev', en: 'next date' })
  c.bool('active', { et: 'aktiivsus', en: 'active flag' })
  c.optStr('lastCreatedInvoiceId', { et: 'viimati loodud arve', en: 'last created invoice' })
  c.optStr('createdAt', { et: 'loomise aeg', en: 'creation time' })
  return c.problem
}

function checkEvent(r: Record<string, unknown>): Text | null {
  const c = new RecordCheck(r)
  c.str('invoiceId', { et: 'arve', en: 'invoice' })
  c.oneOf('kind', { et: 'sündmuse liik', en: 'event kind' }, EVENT_KINDS)
  c.str('at', { et: 'sündmuse aeg', en: 'event time' })
  c.optStr('note', { et: 'märkus', en: 'note' })
  return c.problem
}

function checkDeletionRecord(r: Record<string, unknown>): Text | null {
  const c = new RecordCheck(r)
  c.str('number', { et: 'number', en: 'number' }, true)
  c.oneOf('type', { et: 'dokumendi liik', en: 'document type' }, INVOICE_TYPES)
  c.time('deletedAt', { et: 'kustutamise aeg', en: 'deletion time' })
  return c.problem
}

function checkRecords(
  list: unknown,
  what: { et: string; en: string; one: (n: number, r: unknown) => Text },
  extra: (r: Record<string, unknown>) => Text | null,
  versioned = true,
) {
  if (!Array.isArray(list)) {
    throw new BackupFormatError(`Varukoopias puudub loend: ${what.et}`, `Backup is missing the ${what.en} list`)
  }
  if (list.length > BACKUP_LIMITS.records) {
    throw new BackupFormatError(
      `Varukoopias on liiga palju kirjeid (${what.et}: ${list.length}, lubatud kuni ${BACKUP_LIMITS.records}).`,
      `The backup has too many records (${what.en}: ${list.length}, at most ${BACKUP_LIMITS.records}).`,
    )
  }
  const seen = new Set<string>()
  list.forEach((r, i) => {
    const label = what.one(i + 1, r)
    const fail = (p: Text): never => {
      throw new BackupFormatError(`Varukoopia ${label.et} on vigane: ${p.et}.`, `Backup ${label.en} is invalid: ${p.en}.`)
    }
    if (!isObject(r)) fail({ et: 'kirje ei ole objekt', en: 'the record is not an object' })
    const rec = r as Record<string, unknown>
    if (typeof rec.id !== 'string' || !rec.id) fail(absent(rec.id) || rec.id === '' ? missing({ et: 'ID', en: 'id' }) : invalid({ et: 'ID', en: 'id' }))
    if (versioned && typeof rec.updatedAt !== 'string') fail(absent(rec.updatedAt) ? missing({ et: 'muutmise aeg', en: 'modification time' }) : invalid({ et: 'muutmise aeg', en: 'modification time' }))
    if (seen.has(rec.id as string)) fail({ et: `korduv ID ${String(rec.id)}`, en: `duplicate id ${String(rec.id)}` })
    seen.add(rec.id as string)
    const problem = extra(rec)
    if (problem) fail(problem)
  })
}

/** Validate the shape of an unknown value and return it typed as a BackupFile. Throws BackupFormatError. */
export function validateBackup(data: unknown): BackupFile {
  if (!isObject(data) || data.app !== BACKUP_APP) {
    throw new BackupFormatError('See fail ei ole Arveldaja varukoopia.', 'This file is not an Arveldaja backup.')
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new BackupFormatError(
      `Varukoopia versioon (${String(data.version)}) ei ole toetatud. Uuenda rakendust.`,
      `Backup version ${String(data.version)} is not supported. Please update the app.`,
    )
  }
  if (!Number.isInteger(data.version) || data.version < BACKUP_MIN_VERSION) {
    throw new BackupFormatError(`Tundmatu varukoopia versioon: ${data.version}`, `Unknown backup version: ${data.version}`)
  }
  checkTree(data)
  checkRecords(
    data.clients,
    { et: 'kliendid', en: 'clients', one: (n) => ({ et: `klient nr ${n}`, en: `client #${n}` }) },
    checkClient,
  )
  checkRecords(
    data.invoices,
    {
      et: 'arved',
      en: 'invoices',
      one: (n, r) => {
        const num = isObject(r) && typeof r.number === 'string' && r.number ? ` (${r.number})` : ''
        return { et: `arve nr ${n}${num}`, en: `invoice #${n}${num}` }
      },
    },
    checkInvoice,
  )
  // Added in version 2; optional so that a version 1 file (or a partial export) still reads.
  if (!absent(data.products)) {
    checkRecords(
      data.products,
      { et: 'tooted ja teenused', en: 'products', one: (n) => ({ et: `toode nr ${n}`, en: `product #${n}` }) },
      checkProduct,
    )
  }
  if (!absent(data.recurringRules)) {
    checkRecords(
      data.recurringRules,
      { et: 'korduvarvete reeglid', en: 'recurring rules', one: (n) => ({ et: `korduvarve reegel nr ${n}`, en: `recurring rule #${n}` }) },
      checkRecurringRule,
    )
  }
  if (!absent(data.events)) {
    checkRecords(
      data.events,
      { et: 'arvete sündmused', en: 'invoice events', one: (n) => ({ et: `sündmus nr ${n}`, en: `event #${n}` }) },
      checkEvent,
      false,
    )
  }
  if (!absent(data.deleted)) {
    checkRecords(
      data.deleted,
      { et: 'kustutatud dokumendid', en: 'deleted documents', one: (n) => ({ et: `kustutatud dokumendi kirje nr ${n}`, en: `deleted document record #${n}` }) },
      checkDeletionRecord,
      false,
    )
  }
  if (!absent(data.profile)) {
    const problem = isObject(data.profile) ? checkProfile(data.profile) : { et: 'kirje ei ole objekt', en: 'the record is not an object' }
    if (problem) {
      throw new BackupFormatError(`Varukoopias olevad ettevõtte andmed on vigased: ${problem.et}.`, `The company profile in the backup is invalid: ${problem.en}.`)
    }
  }
  if (!absent(data.settings)) {
    const problem = isObject(data.settings) ? checkSettings(data.settings) : { et: 'kirje ei ole objekt', en: 'the record is not an object' }
    if (problem) {
      throw new BackupFormatError(`Varukoopia seaded on vigased: ${problem.et}.`, `The settings in the backup are invalid: ${problem.en}.`)
    }
  }
  const out: BackupFile = {
    ...(data as unknown as BackupFile),
    profile: (data.profile ?? null) as BackupFile['profile'],
    settings: (data.settings ?? null) as BackupFile['settings'],
  }
  for (const k of ['products', 'recurringRules', 'events', 'deleted'] as const) if (data[k] === null) delete out[k]
  return out
}

/** Parse backup JSON text (e.g. from a file input or Drive) and validate it. */
export function parseBackup(text: string): BackupFile {
  if (text.length > BACKUP_LIMITS.textLength) {
    throw new BackupFormatError('Varukoopia fail on liiga suur.', 'The backup file is too large.')
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupFormatError('Fail ei ole korrektne JSON.', 'The file is not valid JSON.')
  }
  return validateBackup(data)
}

/** Serialize a backup for download / Drive upload. */
export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

/** Suggested file name, e.g. "arveldaja-backup-2026-10-12.json" (any file name is accepted when importing). */
export function backupFileName(date: Date = new Date()): string {
  return `arveldaja-backup-${date.toISOString().slice(0, 10)}.json`
}

/** True if `a` is strictly newer than `b` (ISO timestamps; unparsable values count as oldest). */
export function isNewer(a: string | undefined, b: string | undefined): boolean {
  const ta = a ? Date.parse(a) : NaN
  const tb = b ? Date.parse(b) : NaN
  if (Number.isNaN(ta)) return false
  if (Number.isNaN(tb)) return true
  return ta > tb
}
