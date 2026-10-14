// The pane's and band's row model: which rows a session file has, in which order they are drawn.
// Pure: no engine calls, so the store, the renders and the tests share it.
import type { PendingItem, PendingItemKind, PendingItemsPr, PendingItemsSessionFile, PendingItemsView } from '../types'
import { prDismissId } from './prs'

// Row order of the kind view and the band; 'pr' is one of the session's open PRs.
export type Group = PendingItemKind | 'pr'
export const GROUP_ORDER: readonly Group[] = ['question', 'user_action', 'pr', 'next_step', 'unverified']
// Kinds the band lists one by one; the others it only counts.
const BAND_LISTED: readonly Group[] = ['question', 'user_action']

/** One row of the pane: an item or a PR, active or (when shown) done. */
export type Row = { file: PendingItemsSessionFile; isDone: boolean } & (
  | { group: PendingItemKind; item: PendingItem }
  | { group: 'pr'; pr: PendingItemsPr }
)

/** Active rows first, then done rows when `withDone`, so filtering by group keeps that order. */
export function rowsOf(file: PendingItemsSessionFile, withDone: boolean): Row[] {
  const rows: Row[] = file.items.map(item => ({ file, isDone: false, group: item.kind, item }))
  for (const pr of file.prs) rows.push({ file, isDone: false, group: 'pr', pr })
  if (!withDone) return rows
  for (const entry of file.done) {
    rows.push('item' in entry
      ? { file, isDone: true, group: entry.item.kind, item: entry.item }
      : { file, isDone: true, group: 'pr', pr: entry.pr })
  }
  return rows
}

export function rowId(row: Row): string {
  return row.group === 'pr' ? prDismissId(row.pr) : row.item.id
}

export function activeCount(rows: Row[]): number {
  return rows.filter(row => !row.isDone).length
}

/** The rows by group in GROUP_ORDER, empty groups left out: the order both views draw. */
export function byGroup(rows: Row[]): { group: Group; rows: Row[] }[] {
  return GROUP_ORDER.flatMap(group => {
    const inGroup = rows.filter(row => row.group === group)
    return inGroup.length === 0 ? [] : [{ group, rows: inGroup }]
  })
}

/** The ✓/↺ control of a row: one key whether the row is active or done. */
export function actKey(sessionId: string, id: string): string {
  return `act:${sessionId}:${id}`
}

/** What decides which rows the pane draws. */
export type Shown = { self: string | null; mode: PendingItemsView; withDone: boolean }

/** Every row the pane draws, in drawing order (the session boxes, or the kind boxes). */
function drawnRows(list: PendingItemsSessionFile[], shown: Shown): Row[] {
  if (shown.mode === 'kind') return byGroup(list.flatMap(file => rowsOf(file, shown.withDone))).flatMap(g => g.rows)
  const files = shown.mode === 'self' ? list.filter(file => file.sessionId === shown.self) : list
  return files.flatMap(file => byGroup(rowsOf(file, shown.withDone)).flatMap(g => g.rows))
}

function rowActKey(row: Row): string {
  return actKey(row.file.sessionId, rowId(row))
}

/**
 * Where the focus goes after a press on `key` changes the session files from `before` to
 * `after`: the pressed control while it is still drawn (✓ and ↺ share a key); else the ✓/↺ of
 * the next row still drawn, in drawing order, else of the previous one, else the selected view
 * tab. A focus request for a key no longer drawn is refused, and the ring would be left on
 * nothing. Exported for the tests: the test kit does not answer a plugin's `$.ui.focus`.
 */
export function focusAfter(before: PendingItemsSessionFile[], after: PendingItemsSessionFile[], shown: Shown, key: string): string {
  const remaining = new Set(drawnRows(after, shown).map(rowActKey))
  if (remaining.has(key)) return key
  const keys = drawnRows(before, shown).map(rowActKey)
  const at = keys.indexOf(key)
  const next = keys.slice(at + 1).find(k => remaining.has(k))
  const previous = keys.slice(0, Math.max(at, 0)).reverse().find(k => remaining.has(k))
  return next ?? previous ?? `view-${shown.mode}`
}

/** The band's listed rows' ids, as the close button records them. */
export function bandIds(rows: Row[]): string[] {
  return rows.filter(row => BAND_LISTED.includes(row.group)).map(row => `${row.file.sessionId}:${rowId(row)}`)
}
