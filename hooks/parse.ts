// Validation of the tool's input and of the session files and Desktop records read from disk, and
// the done entries' expiry. Pure: register.tsx reads and writes the files.
import type { PendingItem, PendingItemKind, PendingItemsDone, PendingItemsPr, PendingItemsSessionFile, PendingItemsSessionState } from '../types'
import { firstLine, isObject, stripControls } from './common'
import { INPUT_ERRORS } from './prompts'
import { parsePr, prDismissId, uniqueByUrl } from './prs'
import { HOST_ID_PATTERN, SESSION_ID_PATTERN } from './store'

// The values of the unions declared in types/index.d.ts, which must stay import-free. The checks
// below fail the type-check when a list misses a member of its union or names something else.
export const KINDS = ['question', 'user_action', 'unverified', 'next_step'] as const
const STATES = ['running', 'background', 'waiting_permission', 'idle', 'interrupted', 'error', 'ended'] as const

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const KINDS_MATCH_DECLARED: Exactly<(typeof KINDS)[number], PendingItemKind> = true
const STATES_MATCH_DECLARED: Exactly<(typeof STATES)[number], PendingItemsSessionState> = true

/** What changed in the stored list: items to add or replace by id, and ids to remove. */
export type ItemChanges = { upsert: PendingItem[]; remove: string[] }

/**
 * The tool's input after validation: the full list, which replaces the stored one (no activity
 * clears it), or what changed in it (no title or activity keeps the stored one; activity '' clears it).
 */
export type SetInput =
  | { title: string; items: PendingItem[]; activity?: string }
  | { title?: string; changes: ItemChanges; activity?: string }

/** The most the tool takes, and a session file may hold: items per list, characters per field. */
export const LIMITS = { items: 50, id: 64, text: 500, title: 120, owner: 60, activity: 120, url: 2000 } as const

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

// An http: or https: URL with a host, and no whitespace or control character anywhere. http: is
// kept for local links such as a dev server's; schemes like file: and javascript: are refused.
const WEB_URL = /^https?:\/\/[^\s/?#\u0000-\u001f\u007f-\u009f]+(?:[/?#][^\s\u0000-\u001f\u007f-\u009f]*)?$/

// A question's choice buttons: few and short, so they fit on one line under it.
export const OPTIONS_MIN = 2
export const OPTIONS_MAX = 4
export const OPTION_MAX_LENGTH = 40

/**
 * A question's `options`: undefined when absent, null when refused (not on a question, not
 * 2-4 distinct non-empty one-line strings, or one too long), else the trimmed strings.
 */
function parseOptions(options: unknown, kind: string): string[] | undefined | null {
  if (options === undefined) return undefined
  if (kind !== 'question' || !Array.isArray(options)) return null
  if (options.length < OPTIONS_MIN || options.length > OPTIONS_MAX) return null
  const trimmed: string[] = []
  for (const option of options) {
    if (typeof option !== 'string') return null
    const text = stripControls(option).trim()
    if (text === '' || text.length > OPTION_MAX_LENGTH || text.includes('\n') || trimmed.includes(text)) return null
    trimmed.push(text)
  }
  return trimmed
}

/** An id: a non-empty string of at most LIMITS.id characters, with no control character; `field` names it in the reason. */
function parseId(id: unknown, field: string): string | { error: string } {
  if (typeof id !== 'string' || id === '' || stripControls(id) !== id) return { error: INPUT_ERRORS.nonEmpty(field) }
  if (id.length > LIMITS.id) return { error: INPUT_ERRORS.tooLong(field, LIMITS.id) }
  return id
}

/**
 * One item, from the tool's input or a session file, `at` naming it (`items[0]`); returns the
 * reason when it is refused.
 */
function parseItem(item: unknown, at: string): PendingItem | { error: string } {
  if (!isObject(item)) return { error: INPUT_ERRORS.item(at) }
  const { kind, text, owner, url, options } = item
  const id = parseId(item.id, `${at}.id`)
  if (typeof id !== 'string') return id
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    return { error: INPUT_ERRORS.kind(at, KINDS) }
  }
  const body = typeof text === 'string' ? stripControls(text).trim() : ''
  if (body === '') return { error: INPUT_ERRORS.nonEmpty(`${at}.text`) }
  if (body.length > LIMITS.text) return { error: INPUT_ERRORS.tooLong(`${at}.text`, LIMITS.text) }
  if (!optionalString(owner) || !optionalString(url)) return { error: INPUT_ERRORS.ownerUrl(at) }
  const who = owner === undefined ? '' : stripControls(owner).trim()
  if (who.length > LIMITS.owner) return { error: INPUT_ERRORS.tooLong(`${at}.owner`, LIMITS.owner) }
  const link = url ?? ''
  if (link.length > LIMITS.url) return { error: INPUT_ERRORS.tooLong(`${at}.url`, LIMITS.url) }
  if (link !== '' && !WEB_URL.test(link)) return { error: INPUT_ERRORS.url(at) }
  const choices = parseOptions(options, kind)
  if (choices === null) return { error: INPUT_ERRORS.options(at, OPTIONS_MIN, OPTIONS_MAX, OPTION_MAX_LENGTH) }
  return {
    id,
    kind: kind as PendingItemKind,
    text: body,
    ...(who !== '' ? { owner: who } : {}),
    ...(link !== '' ? { url: link } : {}),
    ...(choices !== undefined ? { options: choices } : {}),
  }
}

/** A one-line field (title, activity): without controls, trimmed; null when over `max`. */
function shortLine(text: string, max: number): string | null {
  const line = stripControls(text).trim()
  return line.length > max ? null : line
}

/** A list of items from the tool's input, `field` naming it; distinct ids, at most LIMITS.items. */
function parseItemList(value: unknown, field: string): PendingItem[] | { error: string } {
  if (!Array.isArray(value)) return { error: INPUT_ERRORS.array(field) }
  if (value.length > LIMITS.items) return { error: INPUT_ERRORS.tooMany(field, LIMITS.items) }
  const parsed: PendingItem[] = []
  for (const [index, item] of value.entries()) {
    const one = parseItem(item, `${field}[${index}]`)
    if ('error' in one) return one
    if (parsed.some(other => other.id === one.id)) return { error: INPUT_ERRORS.duplicateId(`${field}[${index}].id`, one.id) }
    parsed.push(one)
  }
  return parsed
}

/** `changes.remove`: distinct ids, at most LIMITS.items. */
function parseRemove(value: unknown): string[] | { error: string } {
  const field = 'changes.remove'
  if (!Array.isArray(value)) return { error: INPUT_ERRORS.array(field) }
  if (value.length > LIMITS.items) return { error: INPUT_ERRORS.tooMany(field, LIMITS.items) }
  const ids: string[] = []
  for (const [index, entry] of value.entries()) {
    const id = parseId(entry, `${field}[${index}]`)
    if (typeof id !== 'string') return id
    if (ids.includes(id)) return { error: INPUT_ERRORS.duplicateId(`${field}[${index}]`, id) }
    ids.push(id)
  }
  return ids
}

/** `changes`: only `upsert` and `remove`, each optional, and no id in both. */
function parseChanges(value: unknown): ItemChanges | { error: string } {
  if (!isObject(value) || Object.keys(value).some(key => key !== 'upsert' && key !== 'remove')) {
    return { error: INPUT_ERRORS.changes }
  }
  const upsert = value.upsert === undefined ? [] : parseItemList(value.upsert, 'changes.upsert')
  if ('error' in upsert) return upsert
  const remove = value.remove === undefined ? [] : parseRemove(value.remove)
  if ('error' in remove) return remove
  const both = upsert.find(item => remove.includes(item.id))
  if (both !== undefined) return { error: INPUT_ERRORS.upsertAndRemove(both.id) }
  return { upsert, remove }
}

/** A one-line field (title, activity) as sent: undefined when absent, refused when not a string or over `max`. */
function parseLine(value: unknown, field: 'title' | 'activity', max: number): string | undefined | { error: string } {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return { error: INPUT_ERRORS[field] }
  return shortLine(value, max) ?? { error: INPUT_ERRORS.tooLong(field, max) }
}

/** Validates the model's tool input; returns the reason when it is refused. */
export function parseSetInput(input: Record<string, unknown>): SetInput | { error: string } {
  const { title, items, changes, activity } = input
  if ((items === undefined) === (changes === undefined)) return { error: INPUT_ERRORS.itemsOrChanges }
  const name = parseLine(title, 'title', LIMITS.title)
  if (typeof name === 'object') return name
  const line = parseLine(activity, 'activity', LIMITS.activity)
  if (typeof line === 'object') return line
  if (changes !== undefined) {
    const parsed = parseChanges(changes)
    if ('error' in parsed) return parsed
    return { ...(name !== undefined ? { title: name } : {}), changes: parsed, ...(line !== undefined ? { activity: line } : {}) }
  }
  if (name === undefined) return { error: INPUT_ERRORS.title }
  const parsed = parseItemList(items, 'items')
  if ('error' in parsed) return parsed
  return { title: name, items: parsed, ...(line !== undefined && line !== '' ? { activity: line } : {}) }
}

function parseDone(value: unknown, index: number): PendingItemsDone | { error: string } {
  const refused = { error: `done[${index}] is not a valid done entry` }
  if (!isObject(value)) return refused
  const { id, doneAt } = value
  if (typeof id !== 'string' || typeof doneAt !== 'number') return refused
  if ('item' in value) {
    const item = parseItem(value.item, 'item')
    return 'error' in item ? { error: `done[${index}]: ${item.error}` } : { id, doneAt, item }
  }
  const pr = parsePr(value.pr)
  return pr === undefined ? refused : { id, doneAt, pr }
}

/**
 * Parses a session file named `<fileName>.json`; returns the reason when it is not one this mod
 * wrote, or holds a field it would refuse from the tool. Such a file is never overwritten.
 */
export function parseSessionFile(text: string, fileName: string): PendingItemsSessionFile | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { error: 'not JSON' }
  }
  if (!isObject(value)) return { error: 'not a JSON object' }
  const v = value
  const { sessionId, updatedAt, cwd, branch, title: rawTitle } = v
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId) || sessionId !== fileName) {
    return { error: 'sessionId does not match the file name' }
  }
  if (typeof updatedAt !== 'number') return { error: 'updatedAt must be a number' }
  if (typeof rawTitle !== 'string' || typeof cwd !== 'string' || typeof branch !== 'string') {
    return { error: 'title, cwd and branch must be strings' }
  }
  const title = shortLine(rawTitle, LIMITS.title)
  if (title === null) return { error: INPUT_ERRORS.tooLong('title', LIMITS.title) }
  const host = v.hostSessionId
  if (!optionalString(host) || (host !== undefined && !HOST_ID_PATTERN.test(host))) {
    return { error: 'hostSessionId is not a Desktop session id' }
  }
  const rawActivity = v.activity
  if (!optionalString(rawActivity)) return { error: INPUT_ERRORS.activity }
  const activity = shortLine(rawActivity ?? '', LIMITS.activity)
  if (activity === null) return { error: INPUT_ERRORS.tooLong('activity', LIMITS.activity) }
  const prError = v.prError
  if (!optionalString(prError)) return { error: 'prError must be a string' }
  const rawDismissed = v.dismissed
  if (!Array.isArray(rawDismissed) || !rawDismissed.every(id => typeof id === 'string')) return { error: 'dismissed must be strings' }
  const dismissed: string[] = rawDismissed
  const rawItems = v.items
  if (!Array.isArray(rawItems)) return { error: INPUT_ERRORS.array('items') }
  if (rawItems.length > LIMITS.items) return { error: INPUT_ERRORS.tooMany('items', LIMITS.items) }
  const items: PendingItem[] = []
  for (const [index, entry] of rawItems.entries()) {
    const item = parseItem(entry, `items[${index}]`)
    if ('error' in item) return item
    items.push(item)
  }
  // Files written before done entries existed have no `done` field.
  const rawDone: unknown = v.done ?? []
  if (!Array.isArray(rawDone)) return { error: 'done must be an array' }
  const done: PendingItemsDone[] = []
  for (const [index, entry] of rawDone.entries()) {
    const parsed = parseDone(entry, index)
    if ('error' in parsed) return parsed
    done.push(parsed)
  }
  // `pr` alone is a file written before `prs` existed, or one an older pre-release writer changed: it
  // replaces `pr` with its own branch lookup and leaves `prs` as it found it, so both are read.
  // A PR the person marked done in such a writer's pane is in `dismissed` but may still be in `prs`.
  const rawPrs: unknown = v.prs ?? []
  if (!Array.isArray(rawPrs)) return { error: 'prs must be an array' }
  const stored = [...rawPrs, ...(v.pr === undefined || v.pr === null ? [] : [v.pr])].map(parsePr)
  if (stored.some(pr => pr === undefined)) return { error: 'a stored PR is not a github.com pull request' }
  const prs = uniqueByUrl(stored as PendingItemsPr[]).filter(pr => !dismissed.includes(prDismissId(pr)))
  const notify = Array.isArray(v.notify) ? v.notify.filter((id): id is string => typeof id === 'string') : []
  // Files written before states existed have neither field; a malformed pair is dropped, not the file.
  const hasState = typeof v.state === 'string' && (STATES as readonly string[]).includes(v.state) && typeof v.stateAt === 'number'
  return {
    sessionId,
    title,
    cwd,
    branch,
    items,
    dismissed,
    done,
    prs,
    updatedAt,
    ...(host !== undefined ? { hostSessionId: host } : {}),
    ...(prError !== undefined ? { prError: firstLine(prError) } : {}),
    // Files written by older pre-release versions have no `activity`.
    ...(activity !== '' ? { activity } : {}),
    // Files written by older pre-release versions have no `notify`.
    ...(notify.length > 0 ? { notify } : {}),
    ...(hasState ? { state: v.state as PendingItemsSessionState, stateAt: v.stateAt as number } : {}),
  }
}

/**
 * A session file as written: `pr` repeats the first of `prs`, so an older pre-release reader, which
 * knows only `pr`, still shows one of the session's PRs.
 */
export type SessionFileOnDisk = PendingItemsSessionFile & { pr?: PendingItemsPr }

export function toDisk(file: PendingItemsSessionFile): SessionFileOnDisk {
  const [first] = file.prs
  return first === undefined ? file : { ...file, pr: first }
}

/**
 * Whether a Desktop app session record says it is archived. The format is the app's own and
 * undocumented, so text that does not parse, or lacks a literal `isArchived: true`, is not archived.
 */
export function isArchivedRecord(text: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return false
  }
  return isObject(value) && value.isArchived === true
}

/** Done entries are kept this long so they can still be shown and undone. */
const DONE_TTL_MS = 7 * 24 * 3600 * 1000

/** The file without done entries older than DONE_TTL_MS at `now`. */
export function pruneDone(file: PendingItemsSessionFile, now: number): PendingItemsSessionFile {
  return { ...file, done: file.done.filter(entry => now - entry.doneAt < DONE_TTL_MS) }
}

/** True when the file still has something to show; pass a file already pruned of expired done entries. */
export function hasContent(file: PendingItemsSessionFile): boolean {
  return file.items.length > 0 || file.prs.length > 0 || file.prError !== undefined || file.done.length > 0
}
