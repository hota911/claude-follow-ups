// The plugin's names, shared by the modules. No engine calls here or in any module but
// register.tsx: the engine follows `$` only into functions declared in the hooks module itself,
// never across an import.
import { firstLine } from './parse'

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
