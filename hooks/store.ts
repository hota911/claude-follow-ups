// Where the session files live, and the serial queue every read-then-write of one runs on.
// The reads and writes themselves call the engine, so they stay in register.tsx.
import type { PendingItemsSessionFile } from '../types'

// The Desktop app's session ids; one becomes a file name under its records, so nothing else is accepted.
export const HOST_ID_PATTERN = /^local_[A-Za-z0-9-]+$/

export function sessionsDirOf(home: string): string {
  return `${home}/.claude/follow-ups/sessions`
}

/** The root of the Desktop app's session records: `<account>/<org>/<id>.json` under it. */
export function hostRecordsRootOf(home: string): string {
  return `${home}/Library/Application Support/Claude/claude-code-sessions`
}

// Session ids become file names; nothing that could leave the directory is accepted.
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export function sessionPathOf(dir: string, sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`)
  return `${dir}/${sessionId}.json`
}

/**
 * A session file that exists but does not parse as one (see parseSessionFile). It is never
 * overwritten; the message names the file and the reason, never its contents.
 */
export class InvalidSessionFileError extends Error {
  constructor(fileName: string, reason: string) {
    super(`${fileName}.json is not a valid follow-ups session file (${reason}); it was left unchanged`)
  }
}

// The tail of the queue withFile runs on; module scope, as it holds a promise, not state to draw.
let fileQueue: Promise<unknown> = Promise.resolve()

/**
 * Runs one read-then-write of a session file after the previous one in this process has
 * finished, so a write never puts back what another just changed (a press during a turn's
 * state write, say). Never nest it: the inner call would wait on the outer one forever.
 */
export function withFile<T>(work: () => Promise<T>): Promise<T> {
  const run = fileQueue.then(work)
  fileQueue = run.catch(() => undefined)
  return run
}

/** This session's file and the fields its writes refresh. */
export type OwnBase = {
  id: string
  path: string
  cwd: string
  branch: string
  /** Fields refreshed on every write of this session's file. */
  fresh: Pick<PendingItemsSessionFile, 'cwd' | 'branch' | 'hostSessionId'>
}

export function blankFile(id: string, cwd: string, branch: string, now: number): PendingItemsSessionFile {
  return { sessionId: id, title: '', cwd, branch, items: [], dismissed: [], done: [], prs: [], updatedAt: now }
}
