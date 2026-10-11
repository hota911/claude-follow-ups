// The world every test file starts from: a fake home, process runner, clock and agents, and
// helpers to start a session and mount the pane and band.
import { mock, type Engine } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

import type { PendingItemsSessionFile } from '../types'
import type { SessionFileOnDisk } from '../hooks/parse'

export const HOME = '/home/u'
export const DIR = `${HOME}/.claude/follow-ups/sessions`
export const RECORDS = `${HOME}/Library/Application Support/Claude/claude-code-sessions`
export const SELF = 'session-a'
export const CWD = '/work/project'
export const TOOL = 'mcp__follow-ups__pending_items_set'
export const NOW = Date.parse('2026-10-10T10:00:00Z')
export const PANE_PROPS = {
  title: 'Follow-ups', isFocused: false, bodyColumns: 60, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 5 }, view: {},
}
export const BAND_PROPS = {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 }, view: {},
}

export type Ran = { exitCode: number; stdout: string; stderr: string }
export type Gh = (argv: readonly string[]) => Ran | Promise<Ran>

export const NO_PR: Gh = () => ({ exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "main"\n' })

export function prJson(state: string): string {
  return JSON.stringify({ number: 42, title: 'Add the logs', url: 'https://github.com/o/project/pull/42', state, isDraft: false })
}

export function fileOf(id: string, fields: Partial<PendingItemsSessionFile>): PendingItemsSessionFile {
  return { sessionId: id, title: '', cwd: CWD, branch: 'main', items: [], dismissed: [], done: [], prs: [], updatedAt: NOW, ...fields }
}

export type Bash = (command: string) => string

/** The world beneath the plugin: an in-memory disk under HOME, gh as the test says, git, open and the prompt box. */
export function world(on: On, gh: Gh, seed: PendingItemsSessionFile[] = [], env: Record<string, string> = {}) {
  const disk = new Map<string, string>(seed.map(f => [`${DIR}/${f.sessionId}.json`, JSON.stringify(f)]))
  const opened: string[][] = []
  const removed: string[] = []
  const panesOpened: string[] = []
  /**
   * The prompt box's text, the mode of every fill in order, and what every read waits on first.
   * `dropsTrailingNewlines` keeps a fill without its trailing newlines, as the Desktop surface
   * reads it back; `typedDuringFill` is text the person types right after the next fill.
   */
  const prompt = {
    draft: '', modes: [] as (string | undefined)[], readGate: Promise.resolve(),
    dropsTrailingNewlines: false, typedDuringFill: '',
  }
  /** Every prompt that entered the session, in order. */
  const submitted: string[] = []
  /** What every submit waits on first (a busy session), and whether it then fails. */
  const submits = { gate: Promise.resolve(), fails: false }
  const clipboard = { works: true, copied: [] as string[] }
  const toasts: string[] = []
  const agents: AgentInfo[] = []
  let answerGh = gh
  let answerBash: Bash = () => ''
  mock.store(on, {})
  // Bash as the engine answers it: the command's stdout, as the tool's record and as the model's text.
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    const stdout = answerBash(e.command)
    return { result: { stdout, stderr: '', interrupted: false }, text: stdout }
  })
  mock.env(on, { HOME, ...env })
  on('prompt.read', async () => {
    // A held read lets a test start a second press while the first is still between read and fill.
    await prompt.readGate
    return { value: { text: prompt.draft, cursor: prompt.draft.length } }
  })
  on('prompt.fill', ($, e) => {
    prompt.modes.push(e.mode)
    const text = prompt.dropsTrailingNewlines ? e.text.replace(/\n+$/, '') : e.text
    prompt.draft = (e.mode === 'append' ? prompt.draft + text : text) + prompt.typedDuringFill
    prompt.typedDuringFill = ''
    return { isFilled: true }
  })
  const clock = mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.compose', () => ({ sections: [] }))
  on('session.id', () => ({ value: SELF }))
  on('session.cwd', () => ({ value: CWD }))
  on('agent.list', () => ({ value: agents.map(a => ({ ...a })) }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__follow-ups__${e.name}` } }))
  on('ui.open', ($, e) => {
    panesOpened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('fs.exists', ($, e) => ({ value: disk.has(e.path) || [...disk.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  /** Runs once, right after the next read of its path: another writer acting between two reads. */
  const afterRead = new Map<string, () => void>()
  on('fs.read', ($, e) => {
    const text = disk.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    const then = afterRead.get(e.path)
    afterRead.delete(e.path)
    then?.()
    return { value: text }
  })
  on('fs.write', ($, e) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  // A key's first segment below the path is a file when it is the last one, a directory otherwise.
  on('fs.list', ($, e) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const k of disk.keys()) {
      if (!k.startsWith(`${e.path}/`)) continue
      const [name = '', ...deeper] = k.slice(e.path.length + 1).split('/')
      names.set(name, deeper.length > 0 ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', async ($, e) => {
    const done = { isStdoutTruncated: false, isStderrTruncated: false }
    if (e.argv[0] === 'open') {
      opened.push([...e.argv])
      return { value: { exitCode: 0, stdout: '', stderr: '', ...done } }
    }
    if (e.argv[0] === 'rm') {
      const path = e.argv[e.argv.length - 1] ?? ''
      removed.push(path)
      disk.delete(path)
      return { value: { exitCode: 0, stdout: '', stderr: '', ...done } }
    }
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: 'main\n', stderr: '', ...done } }
    return { value: { ...(await answerGh(e.argv)), ...done } }
  })
  // The prompt enters as it arrived at the bottom, context included, as core answers it.
  on('prompt.submit', async ($, e) => {
    await submits.gate
    if (submits.fails) throw new Error('the session refused the prompt')
    submitted.push(e.text)
    return { text: e.text, ...(e.context !== undefined ? { context: e.context } : {}) }
  })
  on('ui.copy', ($, e) => {
    if (!clipboard.works) return { value: { isCopied: false as const, reason: 'no-clipboard' as const } }
    clipboard.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return {
    clock,
    opened,
    removed,
    panesOpened,
    prompt,
    submitted,
    submits,
    clipboard,
    toasts,
    /** The session's agents as `agent.list` answers them; a test edits their statuses in place. */
    agents,
    /** Puts a Desktop app session record (its raw text) where the app keeps it. */
    putRecord: (hostSessionId: string, text: string) => {
      disk.set(`${RECORDS}/acct-1/org-1/${hostSessionId}.json`, text)
    },
    /** Runs `then` once, right after the next read of a Desktop app session record. */
    afterRecordRead: (hostSessionId: string, then: () => void) => {
      afterRead.set(`${RECORDS}/acct-1/org-1/${hostSessionId}.json`, then)
    },
    /** Puts a session file's raw text, as another (older) writer left it. */
    putFile: (id: string, text: string) => {
      disk.set(`${DIR}/${id}.json`, text)
    },
    /** A session file's raw text on disk. */
    raw: (id: string) => disk.get(`${DIR}/${id}.json`),
    /** A session file as written on disk, `pr` included. */
    file: (id: string) => {
      const text = disk.get(`${DIR}/${id}.json`)
      return text === undefined ? undefined : (JSON.parse(text) as SessionFileOnDisk)
    },
    setGh: (next: Gh) => { answerGh = next },
    setBash: (next: Bash) => { answerBash = next },
  }
}

export type World = ReturnType<typeof world>

export async function start($: Engine, w: World) {
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await w.clock.advance(10)
  await w.clock.settle()
}

export function mountPane($: Engine, surface: 'terminal' | 'desktop' = 'desktop', isFocused = false) {
  return $.ui.mount({ plugin: 'follow-ups', surface, component: 'Pane', requestId: 'follow-ups', props: { ...PANE_PROPS, isFocused } })
}

export function mountBand($: Engine, surface: 'terminal' | 'desktop' = 'desktop', hasSurvey = false) {
  return $.ui.mount({ plugin: 'follow-ups', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, hasSurvey } })
}
