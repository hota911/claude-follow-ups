// The plugin's names and the small text helpers the modules share. No engine calls here or in
// any module but register.tsx: the engine follows `$` only into functions declared in the hooks
// module itself, never across an import.

export const PLUGIN = 'follow-ups'
export const PANE = 'follow-ups'
export const PANE_TITLE = 'Follow-ups'
export const TOOL = 'pending_items_set'
export const TOOL_FULL = `mcp__${PLUGIN}__${TOOL}`
export const SHOW_DONE_KEY = 'showDone'
export const BAND_CLOSED_KEY = 'bandClosed'

export function errorLine(err: unknown): string {
  return firstLine(err instanceof Error ? err.message : String(err)) || 'unknown error'
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Terminal escape sequences (CSI, OSC, the other two-character ones), then any control character
// left (C0 but tab and newline, DEL, C1), so stored text can never drive the terminal it is drawn in.
const ESCAPE_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-_])/g
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

/** The text without terminal escape sequences and control characters; tab and newline are kept. */
export function stripControls(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, '').replace(CONTROL, '')
}

/** The first non-blank line, without control characters: error lines come from gh, rm and open. */
export function firstLine(text: string): string {
  return stripControls(text).split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}
