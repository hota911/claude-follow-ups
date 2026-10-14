// The items of a session file: what the tool's write, ✓, ↺, a choice and the done notice change in it.
// Pure: register.tsx reads and writes the file around these.
import type { PendingItem, PendingItemsDone, PendingItemsRecordedState, PendingItemsSessionFile } from '../types'
import { LIMITS, type SetInput } from './parse'
import { doneNotice, INPUT_ERRORS } from './prompts'
import { prDismissId, uniqueByUrl } from './prs'
import { blankFile, type OwnBase } from './store'

/** The written file, the sent ids kept hidden as done, and the removed ids that were not in the list. */
export type SetOutcome = { file: PendingItemsSessionFile; hidden: string[]; missing: string[] }

/**
 * The tool's write, keeping dismissed ids hidden: `items` replaces the session's list, `changes`
 * replaces or appends its upserts by id and drops its removes. `stored` is the file as read
 * (undefined when there is none), `own` its fresh fields, `state` this session's recorded state.
 * Refused when `changes` has no title and there is no file, or the list would exceed LIMITS.items.
 */
export function applySet(
  stored: PendingItemsSessionFile | undefined,
  input: SetInput,
  own: OwnBase,
  state: PendingItemsRecordedState | null,
  now: number,
): SetOutcome | { error: string } {
  if ('changes' in input && input.title === undefined && stored === undefined) return { error: INPUT_ERRORS.changesWithoutFile }
  const { activity: storedActivity, ...base } = stored ?? blankFile(own.id, own.fresh.cwd, own.fresh.branch, now)
  const sent = 'items' in input ? input.items : input.changes.upsert
  const hidden = sent.filter(item => base.dismissed.includes(item.id)).map(item => item.id)
  const shown = sent.filter(item => !base.dismissed.includes(item.id))
  const items = 'items' in input ? shown : withChanges(base.items, shown, input.changes.remove)
  if (items.length > LIMITS.items) return { error: INPUT_ERRORS.listTooLong(items.length, LIMITS.items) }
  const missing = 'items' in input ? [] : input.changes.remove.filter(id => !base.items.some(item => item.id === id))
  const activity = 'items' in input ? input.activity : input.activity ?? storedActivity
  const file: PendingItemsSessionFile = {
    ...base,
    title: input.title ?? base.title,
    ...(activity !== undefined && activity !== '' ? { activity } : {}),
    ...own.fresh,
    items,
    ...(state ?? {}),
    updatedAt: now,
  }
  return { file, hidden, missing }
}

/** The list with `upsert` replacing items of the same id in place, the rest appended, and `remove` dropped. */
function withChanges(items: PendingItem[], upsert: PendingItem[], remove: string[]): PendingItem[] {
  const kept = items
    .filter(item => !remove.includes(item.id))
    .map(item => upsert.find(next => next.id === item.id) ?? item)
  return [...kept, ...upsert.filter(next => !items.some(item => item.id === next.id))]
}

/** The Done button: hides one item (or one PR) of a session's file and keeps a copy for Undo. */
export function dismissed(file: PendingItemsSessionFile, dismissId: string, now: number): PendingItemsSessionFile {
  const item = file.items.find(candidate => candidate.id === dismissId)
  const pr = file.prs.find(candidate => prDismissId(candidate) === dismissId)
  const entry: PendingItemsDone | undefined = item !== undefined
    ? { id: dismissId, doneAt: now, item }
    : pr !== undefined ? { id: dismissId, doneAt: now, pr } : undefined
  const notify = file.notify ?? []
  return {
    ...withNotify(file, item === undefined || notify.includes(dismissId) ? notify : [...notify, dismissId]),
    items: file.items.filter(candidate => candidate.id !== dismissId),
    prs: file.prs.filter(candidate => prDismissId(candidate) !== dismissId),
    dismissed: file.dismissed.includes(dismissId) ? file.dismissed : [...file.dismissed, dismissId],
    done: entry === undefined ? file.done : [...file.done.filter(d => d.id !== dismissId), entry],
  }
}

/** A choice button or a sent ↩ reply: as Done, but `notify` is left as it was, since the answer itself tells the model. */
export function answered(file: PendingItemsSessionFile, id: string, now: number): PendingItemsSessionFile {
  return withNotify(dismissed(file, id, now), file.notify ?? [])
}

/** The Undo button: un-hides a done item (or PR) and puts it back where it was. */
export function undone(file: PendingItemsSessionFile, dismissId: string): PendingItemsSessionFile {
  const entry = file.done.find(d => d.id === dismissId)
  if (entry === undefined) return file
  const restored: Partial<PendingItemsSessionFile> = 'item' in entry
    ? { items: file.items.some(item => item.id === entry.id) ? file.items : [...file.items, entry.item] }
    : { prs: uniqueByUrl([...file.prs, entry.pr]) }
  return {
    ...withNotify(file, (file.notify ?? []).filter(id => id !== dismissId)),
    ...restored,
    dismissed: file.dismissed.filter(id => id !== dismissId),
    done: file.done.filter(d => d.id !== dismissId),
  }
}

/** The file with `notify` set to `ids`, the field left out when there are none. */
export function withNotify(file: PendingItemsSessionFile, ids: string[]): PendingItemsSessionFile {
  const { notify: _notify, ...rest } = file
  return ids.length > 0 ? { ...rest, notify: ids } : rest
}

/**
 * The pending done notice of a file that has one: the items the person marked done since the
 * model was last told (undefined when none of them is an item still in `done`).
 */
export function doneNoticeOf(file: PendingItemsSessionFile, ids: string[]): string | undefined {
  const told = file.done.flatMap(entry => 'item' in entry && ids.includes(entry.id) ? [{ id: entry.id, text: entry.item.text }] : [])
  return told.length > 0 ? doneNotice(told) : undefined
}
