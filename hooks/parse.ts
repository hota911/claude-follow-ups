import type { PendingItem, PendingItemKind, PendingItemsDone, PendingItemsPr, PendingItemsSessionFile, PendingItemsSessionState } from '../types'
import { INPUT_ERRORS } from './prompts'
import { HOST_ID_PATTERN, SESSION_ID_PATTERN } from './store'

export const KINDS: readonly PendingItemKind[] = ['question', 'user_action', 'unverified', 'next_step']
export const STATES: readonly PendingItemsSessionState[] = ['running', 'background', 'waiting_permission', 'idle', 'interrupted', 'error', 'ended']

/** The tool's input after validation. */
export type SetInput = { title: string; items: PendingItem[]; activity?: string }

/** The most the tool takes, and a session file may hold: items per list, characters per field. */
export const LIMITS = { items: 50, id: 64, text: 500, title: 120, owner: 60, activity: 120, url: 2000 } as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

// Terminal escape sequences (CSI, OSC, the other two-character ones), then any control character
// left (C0 but tab and newline, DEL, C1), so stored text can never drive the terminal it is drawn in.
const ESCAPE_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-_])/g
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

/** The text without terminal escape sequences and control characters; tab and newline are kept. */
export function stripControls(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, '').replace(CONTROL, '')
}

// An https: URL with a host, and no whitespace or control character anywhere.
const HTTPS_URL = /^https:\/\/[^\s/?#\u0000-\u001f\u007f-\u009f]+(?:[/?#][^\s\u0000-\u001f\u007f-\u009f]*)?$/

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

/** One item, from the tool's input or a session file; returns the reason when it is refused. */
function parseItem(item: unknown, index: number): PendingItem | { error: string } {
  if (!isObject(item)) return { error: INPUT_ERRORS.item(index) }
  const { id, kind, text, owner, url, options } = item
  if (typeof id !== 'string' || id === '' || stripControls(id) !== id) return { error: INPUT_ERRORS.id(index) }
  if (id.length > LIMITS.id) return { error: INPUT_ERRORS.tooLong(`items[${index}].id`, LIMITS.id) }
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    return { error: INPUT_ERRORS.kind(index, KINDS) }
  }
  const body = typeof text === 'string' ? stripControls(text).trim() : ''
  if (body === '') return { error: INPUT_ERRORS.text(index) }
  if (body.length > LIMITS.text) return { error: INPUT_ERRORS.tooLong(`items[${index}].text`, LIMITS.text) }
  if (!optionalString(owner) || !optionalString(url)) return { error: INPUT_ERRORS.ownerUrl(index) }
  const who = owner === undefined ? '' : stripControls(owner).trim()
  if (who.length > LIMITS.owner) return { error: INPUT_ERRORS.tooLong(`items[${index}].owner`, LIMITS.owner) }
  const link = url ?? ''
  if (link.length > LIMITS.url) return { error: INPUT_ERRORS.tooLong(`items[${index}].url`, LIMITS.url) }
  if (link !== '' && !HTTPS_URL.test(link)) return { error: INPUT_ERRORS.url(index) }
  const choices = parseOptions(options, kind)
  if (choices === null) return { error: INPUT_ERRORS.options(index, OPTIONS_MIN, OPTIONS_MAX, OPTION_MAX_LENGTH) }
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

/** Validates the model's tool input; returns the reason when it is refused. */
export function parseSetInput(input: Record<string, unknown>): SetInput | { error: string } {
  const { title, items, activity } = input
  if (typeof title !== 'string') return { error: INPUT_ERRORS.title }
  const name = shortLine(title, LIMITS.title)
  if (name === null) return { error: INPUT_ERRORS.tooLong('title', LIMITS.title) }
  if (!optionalString(activity)) return { error: INPUT_ERRORS.activity }
  const line = shortLine(activity ?? '', LIMITS.activity)
  if (line === null) return { error: INPUT_ERRORS.tooLong('activity', LIMITS.activity) }
  if (!Array.isArray(items)) return { error: INPUT_ERRORS.items }
  if (items.length > LIMITS.items) return { error: INPUT_ERRORS.tooMany(LIMITS.items) }
  const seen = new Set<string>()
  const parsed: PendingItem[] = []
  for (const [index, item] of items.entries()) {
    const one = parseItem(item, index)
    if ('error' in one) return one
    if (seen.has(one.id)) return { error: INPUT_ERRORS.duplicateId(index, one.id) }
    seen.add(one.id)
    parsed.push(one)
  }
  return { title: name, items: parsed, ...(line !== '' ? { activity: line } : {}) }
}

/** A stored PR as this mod writes it, its url a github.com PR's; undefined when it is not one. */
function parsePr(value: unknown): PendingItemsPr | undefined {
  if (!isObject(value)) return undefined
  const { number, title, url, isDraft } = value
  if (!Number.isInteger(number) || typeof title !== 'string' || typeof url !== 'string' || typeof isDraft !== 'boolean') return undefined
  if (!PR_URL_EXACT.test(url)) return undefined
  return { number: number as number, title: stripControls(title), url, isDraft }
}

function parseDone(value: unknown, index: number): PendingItemsDone | { error: string } {
  const refused = { error: `done[${index}] is not a valid done entry` }
  if (!isObject(value)) return refused
  const { id, doneAt } = value
  if (typeof id !== 'string' || typeof doneAt !== 'number') return refused
  if ('item' in value) {
    const item = parseItem(value.item, index)
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
  if (!Array.isArray(rawItems)) return { error: INPUT_ERRORS.items }
  if (rawItems.length > LIMITS.items) return { error: INPUT_ERRORS.tooMany(LIMITS.items) }
  const items: PendingItem[] = []
  for (const [index, entry] of rawItems.entries()) {
    const item = parseItem(entry, index)
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

/** The PRs in order with later copies of a url left out. */
export function uniqueByUrl(prs: PendingItemsPr[]): PendingItemsPr[] {
  return prs.filter((pr, index) => prs.findIndex(other => other.url === pr.url) === index)
}

// `gh pr create` as a command of the shell line, not inside a longer word.
const GH_PR_CREATE = /(^|[\s;&|(])gh\s+pr\s+create\b/
const PR_URL = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g
// A whole string that is one such url: the only PR url stored, or passed to gh.
const PR_URL_EXACT = new RegExp(`^${PR_URL.source}$`)

/** The PR urls a Bash command printed, when the command runs `gh pr create`; none otherwise. */
export function createdPrUrls(command: string, stdout: string): string[] {
  if (!GH_PR_CREATE.test(command)) return []
  return [...new Set(stdout.match(PR_URL) ?? [])]
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

/** Older than this, a state other than 'ended' is shown as possibly stale: a crashed process never writes 'ended'. */
export const STALE_STATE_MS = 24 * 3600 * 1000

/** Done entries are kept this long so they can still be shown and undone. */
export const DONE_TTL_MS = 7 * 24 * 3600 * 1000

/** The file without done entries older than DONE_TTL_MS at `now`. */
export function pruneDone(file: PendingItemsSessionFile, now: number): PendingItemsSessionFile {
  return { ...file, done: file.done.filter(entry => now - entry.doneAt < DONE_TTL_MS) }
}

// Shape of `gh pr view --json number,title,url,state,isDraft`.
type GhPrView = { number: number; title: string; url: string; state: string; isDraft: boolean }

/**
 * The PR when it is open; undefined when merged or closed. Throws on a PR this mod would not store
 * (a url outside github.com, say), so the lookup shows as failed instead of writing a file no
 * reader takes.
 */
export function parsePrView(stdout: string): PendingItemsPr | undefined {
  const view = JSON.parse(stdout) as GhPrView
  if (view.state !== 'OPEN') return undefined
  const pr = parsePr({ number: view.number, title: view.title, url: view.url, isDraft: view.isDraft })
  if (pr === undefined) throw new Error('gh returned a PR that is not a github.com pull request')
  return pr
}

/** gh's answer for a branch or directory that can have no PR: not an error to show. */
export function meansNoPr(stderr: string): boolean {
  return /no pull requests found|not a git repository/i.test(stderr)
}

export function prDismissId(pr: PendingItemsPr): string {
  return `pr:${pr.url}`
}

/** True when the file still has something to show; pass a file already pruned of expired done entries. */
export function hasContent(file: PendingItemsSessionFile): boolean {
  return file.items.length > 0 || file.prs.length > 0 || file.prError !== undefined || file.done.length > 0
}

/** The first non-blank line, without control characters: error lines come from gh, rm and open. */
export function firstLine(text: string): string {
  return stripControls(text).split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}
