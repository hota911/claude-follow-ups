import type { PendingItem, PendingItemKind, PendingItemsPr, PendingItemsSessionFile, PendingItemsSessionState } from '../types'
import { INPUT_ERRORS } from './prompts'

export const KINDS: readonly PendingItemKind[] = ['question', 'user_action', 'unverified', 'next_step']
export const STATES: readonly PendingItemsSessionState[] = ['running', 'background', 'waiting_permission', 'idle', 'interrupted', 'error', 'ended']

/** The tool's input after validation. */
export type SetInput = { title: string; items: PendingItem[]; activity?: string }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

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
    const text = option.trim()
    if (text === '' || text.length > OPTION_MAX_LENGTH || text.includes('\n') || trimmed.includes(text)) return null
    trimmed.push(text)
  }
  return trimmed
}

/** Validates the model's tool input; returns the reason when it is refused. */
export function parseSetInput(input: Record<string, unknown>): SetInput | { error: string } {
  const { title, items, activity } = input
  if (typeof title !== 'string') return { error: INPUT_ERRORS.title }
  if (!optionalString(activity)) return { error: INPUT_ERRORS.activity }
  if (!Array.isArray(items)) return { error: INPUT_ERRORS.items }
  const seen = new Set<string>()
  const parsed: PendingItem[] = []
  for (const [index, item] of items.entries()) {
    if (!isObject(item)) return { error: INPUT_ERRORS.item(index) }
    const { id, kind, text, owner, url, options } = item
    if (typeof id !== 'string' || id === '') return { error: INPUT_ERRORS.id(index) }
    if (seen.has(id)) return { error: INPUT_ERRORS.duplicateId(index, id) }
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
      return { error: INPUT_ERRORS.kind(index, KINDS) }
    }
    if (typeof text !== 'string' || text.trim() === '') return { error: INPUT_ERRORS.text(index) }
    if (!optionalString(owner) || !optionalString(url)) return { error: INPUT_ERRORS.ownerUrl(index) }
    const choices = parseOptions(options, kind)
    if (choices === null) return { error: INPUT_ERRORS.options(index, OPTIONS_MIN, OPTIONS_MAX, OPTION_MAX_LENGTH) }
    seen.add(id)
    parsed.push({
      id,
      kind: kind as PendingItemKind,
      text: text.trim(),
      ...(owner !== undefined && owner !== '' ? { owner } : {}),
      ...(url !== undefined && url !== '' ? { url } : {}),
      ...(choices !== undefined ? { options: choices } : {}),
    })
  }
  const line = activity?.trim() ?? ''
  return { title: title.trim(), items: parsed, ...(line !== '' ? { activity: line } : {}) }
}

/** Parses a session file; undefined when it is not one this mod wrote. */
export function parseSessionFile(text: string): PendingItemsSessionFile | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isObject(value)) return undefined
  const v = value
  if (typeof v.sessionId !== 'string' || typeof v.updatedAt !== 'number' || !Array.isArray(v.items) || !Array.isArray(v.dismissed)) {
    return undefined
  }
  // Files written before done entries existed have no `done` field.
  const done = Array.isArray(v.done) ? v.done : []
  const { state: _state, stateAt: _stateAt, pr: _pr, prs: _prs, activity: _activity, notify: _notify, ...rest } = value as SessionFileOnDisk
  const notify = Array.isArray(v.notify) ? v.notify.filter((id): id is string => typeof id === 'string') : []
  // Files written before states existed have neither field; a malformed pair is dropped, not the file.
  const hasState = typeof v.state === 'string' && (STATES as readonly string[]).includes(v.state) && typeof v.stateAt === 'number'
  const dismissed = v.dismissed as string[]
  // `pr` alone is a file written before `prs` existed, or one an older pre-release writer changed: it
  // replaces `pr` with its own branch lookup and leaves `prs` as it found it, so both are read.
  // A PR the person marked done in such a writer's pane is in `dismissed` but may still be in `prs`.
  const prs = uniqueByUrl([...(Array.isArray(v.prs) ? v.prs as PendingItemsPr[] : []), ...(isObject(v.pr) ? [v.pr as PendingItemsPr] : [])])
    .filter(pr => !dismissed.includes(prDismissId(pr)))
  return {
    ...rest,
    done,
    prs,
    // Files written by older pre-release versions have no `activity`.
    ...(typeof v.activity === 'string' && v.activity !== '' ? { activity: v.activity } : {}),
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

/** The PR when it is open; undefined when merged or closed. */
export function parsePrView(stdout: string): PendingItemsPr | undefined {
  const pr = JSON.parse(stdout) as GhPrView
  if (pr.state !== 'OPEN') return undefined
  return { number: pr.number, title: pr.title, url: pr.url, isDraft: pr.isDraft }
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

export function firstLine(text: string): string {
  return text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}
