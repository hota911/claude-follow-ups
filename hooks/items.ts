// The items of a session file: what the tool's write, ✓, ↺, a choice and the done notice change in it.
// Pure: register.tsx reads and writes the file around these.
import type { PendingItemsDone, PendingItemsSessionFile, PendingItemsSessionState } from '../types'
import { prDismissId, type SetInput, uniqueByUrl } from './parse'
import { doneNotice } from './prompts'
import type { OwnBase } from './store'

export type SetOutcome = { file: PendingItemsSessionFile; hidden: string[] }

/**
 * The tool's write: replaces the session's items and activity, keeping dismissed ids hidden.
 * `stored` is the file as read, `own` its fresh fields, `state` this session's recorded state.
 */
export function applySet(
  stored: PendingItemsSessionFile,
  { title, items, activity }: SetInput,
  own: OwnBase,
  state: { state: PendingItemsSessionState; stateAt: number } | null,
  now: number,
): SetOutcome {
  const { activity: _activity, ...base } = stored
  const hidden = items.filter(item => base.dismissed.includes(item.id)).map(item => item.id)
  const file: PendingItemsSessionFile = {
    ...base,
    title,
    ...(activity !== undefined ? { activity } : {}),
    ...own.fresh,
    items: items.filter(item => !base.dismissed.includes(item.id)),
    ...(state ?? {}),
    updatedAt: now,
  }
  return { file, hidden }
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

/** A choice button: as Done, but `notify` is left as it was, since the answer itself tells the model. */
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
