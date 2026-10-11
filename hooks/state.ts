// A session's state (Running, Background task running, Needs permission, ...): which state each
// end of a turn leaves, and how a state is written into the file. Pure: register.tsx records it.
import type { AgentInfo, AgentStatus, TurnCompleteReason } from 'claude-code'

import type { PendingItemsSessionFile, PendingItemsSessionState } from '../types'

// How each end of a main-loop turn leaves the session.
export const STATE_AFTER: Record<TurnCompleteReason, PendingItemsSessionState> = {
  answer: 'idle',
  aborted: 'interrupted',
  refusal: 'error',
  error: 'error',
}
// Agent statuses that can still report back: not ended, and not idle until a message wakes it.
const ACTIVE_AGENT: readonly AgentStatus[] = ['pending', 'running', 'waiting']

/**
 * Whether a subagent the main loop started (no parentId) is still active, leaving out `except`
 * (one whose turn is ending, which may still be listed as running). A nested agent is not
 * counted: it reports to its own parent, and while that parent runs it is counted instead.
 */
export function hasActiveAgent(agents: readonly AgentInfo[], except?: string): boolean {
  return agents.some(a => a.parentId === undefined && a.id !== except && ACTIVE_AGENT.includes(a.status))
}

/** An answer given while its subagents still run is not the session waiting: they report back to it. */
export function stateAfterMainTurn(reason: TurnCompleteReason, agentsActive: boolean): PendingItemsSessionState {
  return reason === 'answer' && agentsActive ? 'background' : STATE_AFTER[reason]
}

/** The file with its state set; `isTurnStart` also removes the activity, which described the previous turn. */
export function withState(file: PendingItemsSessionFile, state: PendingItemsSessionState, stateAt: number, isTurnStart: boolean): PendingItemsSessionFile {
  const { activity: _activity, ...withoutActivity } = file
  return { ...(isTurnStart ? withoutActivity : file), state, stateAt }
}
