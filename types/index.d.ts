export type PendingItemKind = 'question' | 'user_action' | 'unverified' | 'next_step'

export type PendingItem = {
  id: string
  kind: PendingItemKind
  text: string
  owner?: string
  url?: string
  /** A question's short answers (2-4), each drawn as a button that sends it at once. */
  options?: string[]
}

export type PendingItemsPr = { number: number; title: string; url: string; isDraft: boolean }

/** What the person marked done, kept so it can be shown and undone; `id` is its dismissed id. */
export type PendingItemsDone =
  | { id: string; doneAt: number; item: PendingItem }
  | { id: string; doneAt: number; pr: PendingItemsPr }

/** One session's file under the shared sessions directory. */
export type PendingItemsSessionFile = {
  sessionId: string
  title: string
  cwd: string
  branch: string
  items: PendingItem[]
  /** Ids the person marked done; `pr:<url>` for a dismissed PR. */
  dismissed: string[]
  /**
   * Ids of items the person marked done (and did not undo) that the session's model has not been
   * told about; delivered and cleared at the session's next prompt submit. Absent when empty.
   */
  notify?: string[]
  /** Content of the done entries, pruned after 7 days; absent in files written before it existed. */
  done: PendingItemsDone[]
  /**
   * The session's open PRs, in the order found: the cwd branch's and those its `gh pr create`
   * printed. On disk `pr` also holds the first, for older pre-release readers (SessionFileOnDisk).
   */
  prs: PendingItemsPr[]
  /** The Desktop app's id for the session (`local_<uuid>`), from CLAUDE_CODE_HOST_SESSION_ID; absent outside the app. */
  hostSessionId?: string
  /** First stderr line of the first failed lookup in the last PR check. */
  prError?: string
  /**
   * What the session said it is doing, from the tool's last call in the current turn; removed when
   * a turn starts or a call omits it. Shown only while `state` is 'running' or 'background'.
   */
  activity?: string
  /** What the session was last seen doing; absent in files written before it existed. */
  state?: PendingItemsSessionState
  /** When `state` was written, in ms; set together with it. Writing it leaves `updatedAt` alone. */
  stateAt?: number
  updatedAt: number
}

/**
 * A session's state as its own hooks record it; 'ended' is never written by a crashed process.
 * 'background' is a main loop that answered while subagents it started still run. Older pre-release
 * readers do not know it: they drop the state or never read one.
 */
export type PendingItemsSessionState = 'running' | 'background' | 'waiting_permission' | 'idle' | 'interrupted' | 'error' | 'ended'

export type PendingItemsView = 'self' | 'session' | 'kind'

export type PendingItemsLoad =
  | { status: 'loading' }
  | { status: 'ok'; files: PendingItemsSessionFile[] }
  | { status: 'error'; message: string }

declare module 'claude-code' {
  interface PluginState {
    'follow-ups': {
      files: PendingItemsLoad
      selfId: string | null
      /** Kept for this session only: every session starts on 'self'. */
      view: PendingItemsView
      /** This session's latest state, put on every write of its own file. */
      ownState: { state: PendingItemsSessionState; stateAt: number } | null
      /** Whose counts the band shows; every session starts on 'self'. */
      bandScope: 'self' | 'all'
      /** Whether the pane opens on its own the next time this session's rows go from none to some. */
      paneArmed: boolean
      /** The last failure of a background step (write, PR check), shown in the pane. */
      fault: string | null
      /** Bumped by every local change; a load that began before one does not overwrite it. */
      writeGen: number
      /** Whether done entries are drawn (dim, with Undo). */
      showDone: boolean
      /** Band ids listed when the person closed the band; null while it shows. */
      bandClosed: string[] | null
    }
  }
}
