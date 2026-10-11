// What a row's buttons put in the prompt box (↩), on the clipboard (⧉) or open (↗). Pure:
// register.tsx makes the engine calls with these.
import type { PendingItem, PendingItemKind } from '../types'

// Leads the quote the reply button puts in the prompt box.
const REPLY_KIND: Record<PendingItemKind, string> = {
  question: 'Question',
  user_action: 'Your action',
  next_step: 'Next step',
  unverified: 'Unverified',
}

// The Desktop app's deep link to one of its sessions, by the id it passes in CLAUDE_CODE_HOST_SESSION_ID.
const HOST_LINK_PREFIX = 'claude://claude.ai/epitaxy/'

/** An item quoted line by line, led by its kind. */
export function quoteOf(item: PendingItem): string {
  return `${REPLY_KIND[item.kind]}: ${item.text}`.split('\n').map(line => `> ${line}`).join('\n')
}

/** What a choice button sends: the quote ↩ would fill, then the chosen answer. */
export function answerOf(item: PendingItem, option: string): string {
  return `${quoteOf(item)}\n\n${option}`
}

/**
 * What the reply button fills: the quote alone in an empty box, else the draft followed by the
 * quote on a line of its own. Always the whole box with mode 'replace', on every surface: on the
 * Desktop surface, newlines inserted with prompt.fill mode 'append' collapse into spaces once the
 * person types, while mode 'replace' keeps them (observed 2026-10-11).
 */
export function replyFill(draft: string, quote: string): { text: string; mode: 'replace' } {
  return draft.trim() === ''
    ? { text: `${quote}\n\n`, mode: 'replace' }
    : { text: `${draft}${draft.endsWith('\n') ? '' : '\n'}${quote}\n\n`, mode: 'replace' }
}

/**
 * Whether the box read back after a fill holds what was filled. Trailing whitespace is not
 * compared: the Desktop surface reads a filled box back without its trailing newlines, e.g. a
 * fill ending "\n\n" as the same text without them (observed 2026-10-11).
 */
export function holdsFill(box: string, filled: string): boolean {
  return box.trimEnd() === filled.trimEnd()
}

// The tail of the queue withPromptBox runs on; separate from the session files' queue (store.ts),
// so a fill never waits behind a file write, and the two never nest.
let promptQueue: Promise<unknown> = Promise.resolve()

/**
 * Runs one read-then-fill of the prompt box after the previous one in this process has finished.
 * Button steps run detached, so without it two quick ↩ presses would both read the same draft and
 * the second 'replace' fill would drop the first quote. Never nest it.
 */
export function withPromptBox<T>(work: () => Promise<T>): Promise<T> {
  const run = promptQueue.then(work)
  promptQueue = run.catch(() => undefined)
  return run
}

/** What the copy button copies: the first backtick code span of an item's text, else the whole text. */
export function copyTextOf(text: string): string {
  return /`([^`]+)`/.exec(text)?.[1] ?? text
}

export function hostLinkOf(hostSessionId: string): string {
  return `${HOST_LINK_PREFIX}${hostSessionId}`
}
