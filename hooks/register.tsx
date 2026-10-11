// The hooks and every function that calls the engine. The engine follows `$` only into functions
// declared in this file, never across an import, so the engine calls stay here; what they compute
// and draw lives in the other modules. Matchers stay literal: `claude plugin validate` reads them.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { PendingItem, PendingItemsLoad, PendingItemsPr, PendingItemsSessionFile, PendingItemsSessionState, PendingItemsView } from '../types'
import { answerOf, copyTextOf, hostLinkOf, quoteOf, replyFill, withPromptBox } from './actions'
import { BAND_CLOSED_KEY, errorLine, PANE, PANE_TITLE, PLUGIN, SHOW_DONE_KEY, TOOL, TOOL_FULL } from './common'
import { applySet, dismissed, doneNoticeOf, type SetOutcome, undone, withNotify } from './items'
import {
  createdPrUrls,
  firstLine,
  hasContent,
  isArchivedRecord,
  OPTION_MAX_LENGTH,
  OPTIONS_MAX,
  OPTIONS_MIN,
  parseSessionFile,
  parseSetInput,
  pruneDone,
  type SetInput,
  toDisk,
} from './parse'
import { failedLookup, lookupOf, type PrCheck, type PrLookup, prViewArgv, withPrChecks } from './prs'
import {
  COMMAND_RESULT,
  composeText,
  hiddenResult,
  INPUT_DESCRIPTIONS,
  inputDeny,
  storedResult,
  storeFailedDeny,
  subagentDeny,
  TOOL_DESCRIPTION,
} from './prompts'
import { bandView, paneView, type ViewElements } from './render'
import { bandIds, focusAfter, rowsOf, type Shown } from './rows'
import { hasActiveAgent, STATE_AFTER, stateAfterMainTurn, withState } from './state'
import { blankFile, HOST_ID_PATTERN, hostRecordsRootOf, type OwnBase, sessionPathOf, sessionsDirOf, withFile } from './store'

const REFRESH_MS = 30 * 1000

// The scan that lists a module's state needs literal plugin names here.
const files = atom({ plugin: 'follow-ups', key: 'files' } as const, { status: 'loading' })
const selfId = atom({ plugin: 'follow-ups', key: 'selfId' } as const, null)
const view = atom({ plugin: 'follow-ups', key: 'view' } as const, 'self')
const fault = atom({ plugin: 'follow-ups', key: 'fault' } as const, null)
const showDone = atom({ plugin: 'follow-ups', key: 'showDone' } as const, false)
const bandClosed = atom({ plugin: 'follow-ups', key: 'bandClosed' } as const, null)
const writeGen = atom({ plugin: 'follow-ups', key: 'writeGen' } as const, 0)
const ownState = atom({ plugin: 'follow-ups', key: 'ownState' } as const, null)
const bandScope = atom({ plugin: 'follow-ups', key: 'bandScope' } as const, 'self')
const paneArmed = atom({ plugin: 'follow-ups', key: 'paneArmed' } as const, true)

type Engine = EngineInterface

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: INPUT_DESCRIPTIONS.title },
    activity: { type: 'string', description: INPUT_DESCRIPTIONS.activity },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: INPUT_DESCRIPTIONS.id },
          kind: { type: 'string', enum: ['question', 'user_action', 'unverified', 'next_step'] },
          text: { type: 'string', description: INPUT_DESCRIPTIONS.text },
          owner: { type: 'string', description: INPUT_DESCRIPTIONS.owner },
          url: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'string', maxLength: OPTION_MAX_LENGTH },
            minItems: OPTIONS_MIN,
            maxItems: OPTIONS_MAX,
            description: INPUT_DESCRIPTIONS.options,
          },
        },
        required: ['id', 'kind', 'text'],
      },
    },
  },
  required: ['title', 'items'],
}

// Fixed text: see composeText.
const COMPOSE_TEXT = composeText(TOOL_FULL)

/** Runs a background step; a failure is kept for the pane instead of being dropped. */
function runStep($: Engine, step: () => Promise<void>): void {
  void step().catch(async (err: unknown) => {
    const message = errorLine(err)
    await update($, fault, () => message)
  })
}

/**
 * After a press redraws the pane, puts the focus ring back on the pressed control, so the pane
 * keeps the keyboard and the next click is a press, not a click that only refocuses the pane.
 * A pane that does not hold the keys is refused; that is fine, nothing is lost. Not awaited:
 * the call waits for the element to be drawn, and the press must not wait on it. For the same
 * reason its outcome is ignored: a ring left where it was only costs the user one more click.
 */
function keepFocus($: Engine, key: string): void {
  void $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
}

// --- Session files -------------------------------------------------------------------------

async function homeDir($: Engine): Promise<string> {
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') throw new Error('HOME is not set')
  return home
}

async function sessionsDir($: Engine): Promise<string> {
  return sessionsDirOf(await homeDir($))
}

/**
 * The directories holding the Desktop app's session records, `<account>/<org>/` under its
 * claude-code-sessions directory, found by listing rather than by id. None when the app is absent.
 */
async function hostRecordDirs($: Engine): Promise<string[]> {
  const root = hostRecordsRootOf(await homeDir($))
  if (!(await $.fs.exists(root))) return []
  const dirs: string[] = []
  for (const account of await $.fs.list(root)) {
    if (account.kind !== 'dir') continue
    for (const org of await $.fs.list(`${root}/${account.name}`)) {
      if (org.kind === 'dir') dirs.push(`${root}/${account.name}/${org.name}`)
    }
  }
  return dirs
}

/**
 * Whether the Desktop app has archived the session. Its record is an undocumented format: a
 * missing or unreadable-as-expected record means not archived, so the file is kept.
 */
async function isHostArchived($: Engine, dirs: string[], hostSessionId: string): Promise<boolean> {
  if (!HOST_ID_PATTERN.test(hostSessionId)) return false
  for (const dir of dirs) {
    const path = `${dir}/${hostSessionId}.json`
    if (await $.fs.exists(path)) return isArchivedRecord(await $.fs.read(path))
  }
  return false
}

/** Deletes one session file; `$.fs` has no delete, so `rm` on the exact path. */
async function removeFile($: Engine, path: string): Promise<void> {
  const ran = await $.process.run(['rm', '-f', '--', path], { timeoutMs: 5000 })
  if (ran.exitCode !== 0) throw new Error(firstLine(ran.stderr) || `rm exited with ${ran.exitCode}`)
}

async function fileOf($: Engine, sessionId: string): Promise<string> {
  return sessionPathOf(await sessionsDir($), sessionId)
}

async function readSession($: Engine, path: string): Promise<PendingItemsSessionFile | undefined> {
  if (!(await $.fs.exists(path))) return undefined
  return parseSessionFile(await $.fs.read(path))
}

/**
 * Writes the file with expired done entries pruned. A file with nothing left to show is still
 * written (readers skip it), except that no file is created for a session that never had one.
 */
async function saveFile($: Engine, path: string, file: PendingItemsSessionFile): Promise<void> {
  const pruned = pruneDone(file, await $.clock.now())
  if (!hasContent(pruned) && !(await $.fs.exists(path))) return
  await update($, writeGen, gen => gen + 1)
  await $.fs.write(path, `${JSON.stringify(toDisk(pruned), null, 2)}\n`)
}

/**
 * Reads every session file into `files`. A load that began before a local change (a press,
 * a write) drops its result, so it never puts back what the change replaced; the change's own
 * load publishes. An unchanged result is not written, so it does not redraw the pane.
 * Another session's file whose Desktop session is archived is deleted instead of listed; this
 * session's own file never is.
 */
async function loadFiles($: Engine): Promise<void> {
  const startGen = await read($, writeGen)
  const self = await read($, selfId)
  let loaded: PendingItemsLoad
  try {
    const dir = await sessionsDir($)
    const found: PendingItemsSessionFile[] = []
    const now = await $.clock.now()
    // Listed once per load, and only when some file names a Desktop session.
    let hostDirs: string[] | undefined
    if (await $.fs.exists(dir)) {
      for (const entry of await $.fs.list(dir)) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
        const path = `${dir}/${entry.name}`
        const parsed = parseSessionFile(await $.fs.read(path))
        const host = parsed?.hostSessionId
        if (parsed !== undefined && host !== undefined && self !== null
          && parsed.sessionId !== self && entry.name !== `${self}.json`) {
          hostDirs ??= await hostRecordDirs($)
          if (await isHostArchived($, hostDirs, host)) {
            await withFile(() => removeFile($, path))
            continue
          }
        }
        const file = parsed === undefined ? undefined : pruneDone(parsed, now)
        if (file !== undefined && hasContent(file)) found.push(file)
      }
    }
    found.sort((a, b) => b.updatedAt - a.updatedAt)
    loaded = { status: 'ok', files: found }
  } catch (err) {
    loaded = { status: 'error', message: errorLine(err) }
  }
  if ((await read($, writeGen)) !== startGen) return
  const before = JSON.stringify(await read($, files))
  if (JSON.stringify(loaded) !== before) await update($, files, () => loaded)
  if (loaded.status === 'ok') {
    await reopenBandOnNew($, loaded.files)
    await autoOpenPane($, loaded.files)
  }
}

/**
 * Opens the pane on its own once this session has something to show (items or its PRs): at
 * startup for a resumed session, and when its list goes from empty to non-empty. After that
 * (or after the person closes the pane) it waits until this session's rows empty again.
 */
async function autoOpenPane($: Engine, list: PendingItemsSessionFile[]): Promise<void> {
  const self = await read($, selfId)
  const own = list.find(file => file.sessionId === self)
  const hasRows = own !== undefined && rowsOf(own, false).length > 0
  const armed = await read($, paneArmed)
  if (!hasRows) {
    if (!armed) await update($, paneArmed, () => true)
    return
  }
  if (!armed) return
  await update($, paneArmed, () => false)
  await $.ui.open({ id: PANE, title: PANE_TITLE })
}

/** Shows the band again once an id it did not list when closed appears. */
async function reopenBandOnNew($: Engine, list: PendingItemsSessionFile[]): Promise<void> {
  const closed = await read($, bandClosed)
  if (closed === null) return
  const ids = bandIds(list.flatMap(file => rowsOf(file, false)))
  if (ids.every(id => closed.includes(id))) return
  await setBandClosed($, null)
}

async function setBandClosed($: Engine, closed: string[] | null): Promise<void> {
  await update($, bandClosed, () => closed)
  await $.store.set(BAND_CLOSED_KEY, closed)
}

/**
 * A press on ✓ or ↺: applies `change` to the session's entry in `files` at once, so the
 * drawing follows the first press, keeps the focus on the pressed control (`focusKey`), or on
 * a neighbour when the change takes that control out of the drawing (see focusAfter), then
 * applies the change to the file on disk and reloads.
 */
async function changeSession(
  $: Engine,
  sessionId: string,
  focusKey: string,
  change: (file: PendingItemsSessionFile, now: number) => PendingItemsSessionFile,
): Promise<void> {
  const now = await $.clock.now()
  const shown: Shown = { self: await read($, selfId), mode: await read($, view), withDone: await read($, showDone) }
  let target = focusKey
  await update($, writeGen, gen => gen + 1)
  await update($, files, state => {
    if (state.status !== 'ok') return state
    const changed = state.files.map(file => file.sessionId === sessionId ? change(file, now) : file)
    target = focusAfter(state.files, changed, shown, focusKey)
    return { status: 'ok' as const, files: changed }
  })
  keepFocus($, target)
  const path = await fileOf($, sessionId)
  await withFile(async () => {
    const file = await readSession($, path)
    if (file !== undefined) await saveFile($, path, change(file, now))
  })
  await loadFiles($)
}

// --- PRs -----------------------------------------------------------------------------------

async function currentBranch($: Engine, cwd: string): Promise<string> {
  const ran = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 5000 })
  return ran.exitCode === 0 ? ran.stdout.trim() : ''
}

/** `gh pr view` for the cwd's branch, or for a known PR by its url. */
async function lookUpPr($: Engine, cwd: string, url?: string): Promise<PrLookup> {
  try {
    return lookupOf(await $.process.run(prViewArgv(url), { cwd, timeoutMs: 30000 }))
  } catch (err) {
    return failedLookup(err)
  }
}

/** Looks up every stored PR again by its url, so a merged or closed one is dropped. */
async function recheckAll($: Engine, cwd: string, prs: PendingItemsPr[]): Promise<PrCheck[]> {
  const checks: PrCheck[] = []
  for (const pr of prs) checks.push({ found: await lookUpPr($, cwd, pr.url), recheckOf: pr.url })
  return checks
}

async function ownBase($: Engine): Promise<OwnBase> {
  const id = await $.session.id()
  const path = await fileOf($, id)
  const cwd = await $.session.cwd()
  const branch = await currentBranch($, cwd)
  // A literal name: the engine lists the variables a module reads.
  const host = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  const fresh = { cwd, branch, ...(host !== undefined && HOST_ID_PATTERN.test(host) ? { hostSessionId: host } : {}) }
  return { id, path, cwd, branch, fresh }
}

/** Applies lookups to this session's file, read again first: a press during the gh calls may have changed it. */
async function saveOwnPrChecks($: Engine, own: OwnBase, checks: PrCheck[]): Promise<void> {
  const now = await $.clock.now()
  await withFile(async () => {
    const base = (await readSession($, own.path)) ?? blankFile(own.id, own.cwd, own.branch, now)
    const next = { ...withPrChecks(base, checks), ...own.fresh, ...(await read($, ownState) ?? {}), updatedAt: now }
    await saveFile($, own.path, next)
  })
  await loadFiles($)
}

/**
 * Looks up the cwd branch's PR and re-checks this session's other stored PRs, so a merged one
 * leaves this session's rows at the end of the turn that saw it merged.
 */
async function checkOwnPr($: Engine): Promise<void> {
  const own = await ownBase($)
  const branch: PrCheck = { found: await lookUpPr($, own.cwd) }
  const stored = (await readSession($, own.path))?.prs ?? []
  const others = stored.filter(pr => pr.url !== branch.found.pr?.url)
  await saveOwnPrChecks($, own, [branch, ...(await recheckAll($, own.cwd, others))])
}

/** Records the PRs a `gh pr create` printed, looked up by url: they need not be the cwd's repository. */
async function recordCreatedPrs($: Engine, urls: string[]): Promise<void> {
  const own = await ownBase($)
  const checks: PrCheck[] = []
  for (const url of urls) checks.push({ found: await lookUpPr($, own.cwd, url) })
  await saveOwnPrChecks($, own, checks)
}

/** Re-checks every stored PR by its url, so one merged after its session ended is cleared. */
async function recheckStoredPrs($: Engine): Promise<void> {
  const dir = await sessionsDir($)
  const state = await read($, files)
  if (state.status !== 'ok') return
  for (const listed of state.files) {
    if (listed.prs.length === 0) continue
    const path = `${dir}/${listed.sessionId}.json`
    const file = await readSession($, path)
    if (file === undefined || file.prs.length === 0) continue
    const checks = await recheckAll($, file.cwd, file.prs)
    await withFile(async () => {
      // Read again: a press during the gh calls may have changed the file.
      const latest = await readSession($, path)
      if (latest !== undefined) await saveFile($, path, withPrChecks(latest, checks))
    })
  }
}

async function refresh($: Engine): Promise<void> {
  await update($, fault, () => null)
  await loadFiles($)
  await recheckStoredPrs($)
  await loadFiles($)
}

// --- State and items -----------------------------------------------------------------------

async function anyActiveAgent($: Engine, except?: string): Promise<boolean> {
  return hasActiveAgent(await $.agent.list(), except)
}

/**
 * Records a session's state in its file: this session's (also kept in `ownState`, so its other
 * writes carry it), or the ending one's at session.end. Read just before the write, like the PR
 * check, so it never puts back what a press or the tool changed. `updatedAt` is left alone, so
 * the list does not reorder on every turn, and no file is created for a state alone.
 */
async function recordState(
  $: Engine,
  state: PendingItemsSessionState,
  { sessionId, isTurnStart = false }: { sessionId?: string; isTurnStart?: boolean } = {},
): Promise<void> {
  const stateAt = await $.clock.now()
  const id = sessionId ?? (await $.session.id())
  if (id === (await read($, selfId))) await update($, ownState, () => ({ state, stateAt }))
  const path = await fileOf($, id)
  await withFile(async () => {
    const file = await readSession($, path)
    if (file === undefined) return
    await saveFile($, path, withState(file, state, stateAt, isTurnStart))
  })
}

/** The tool: replaces this session's items and activity, keeping dismissed ids hidden. */
async function setItems($: Engine, input: SetInput): Promise<SetOutcome> {
  const own = await ownBase($)
  const now = await $.clock.now()
  const outcome = await withFile(async () => {
    const stored = (await readSession($, own.path)) ?? blankFile(own.id, own.cwd, own.branch, now)
    const result = applySet(stored, input, own, await read($, ownState), now)
    await saveFile($, own.path, result.file)
    return result
  })
  await loadFiles($)
  return outcome
}

/**
 * Takes this session's pending done notice: the items the person marked done in a pane (any
 * session's) since the model was last told, as one line, and clears it from the file.
 * Undefined when there is none, so the prompt goes in unchanged.
 */
async function takeDoneNotice($: Engine): Promise<string | undefined> {
  const path = await fileOf($, await $.session.id())
  return withFile(async () => {
    const file = await readSession($, path)
    if (file?.notify === undefined) return undefined
    const notice = doneNoticeOf(file, file.notify)
    await saveFile($, path, withNotify(file, []))
    return notice
  })
}

// --- Row buttons ---------------------------------------------------------------------------

/**
 * The reply button: quotes an item, led by its kind, in this session's prompt box, keeping any
 * draft. It reads the draft and fills the whole box once (see replyFill for why it never appends),
 * on the prompt box queue, with no other await between the read and the fill. Text typed during
 * that one round trip is still overwritten; the check after the fill reports a box that does not
 * hold what was filled.
 */
async function replyTo($: Engine, item: PendingItem): Promise<void> {
  await withPromptBox(async () => {
    const fill = replyFill((await $.prompt.read()).text, quoteOf(item))
    const filled = await $.prompt.fill(fill)
    if (!filled.isFilled) throw new Error('the prompt box did not take the quote')
    if (filled.text !== fill.text) throw new Error('the prompt box changed while the quote was put in; check the draft')
  })
}

/**
 * A choice button: sends the quoted question and the chosen answer as the person's own prompt.
 * The engine runs it once the session is idle, so the step waits for the turn running now, if
 * any; it runs detached from every hook, so no hook awaits its own submit. The item stays listed.
 */
async function answerWith($: Engine, item: PendingItem, option: string): Promise<void> {
  await $.prompt.submit({ text: answerOf(item, option), asUser: true })
}

/** The copy button: the pane's text cannot be selected on desktop, so this puts it on the clipboard. */
async function copyItem($: Engine, item: PendingItem, surface: RenderSurface): Promise<void> {
  const copied = await $.ui.copy({ text: copyTextOf(item.text), surface })
  if (!copied.isCopied) throw new Error(`the clipboard did not take the text (${copied.reason})`)
  $.ui.toast('Copied')
}

/**
 * Opens another session in the Desktop app by its deep link. A Link cannot carry it: the
 * desktop surface draws any href but https: as plain text. `open` is macOS's URL opener.
 */
async function openHostSession($: Engine, hostSessionId: string): Promise<void> {
  const ran = await $.process.run(['open', hostLinkOf(hostSessionId)], { timeoutMs: 5000 })
  if (ran.exitCode !== 0) throw new Error(firstLine(ran.stderr) || `open exited with ${ran.exitCode}`)
}

/**
 * The Resume button: puts `/resume <id>` in this session's prompt box for the person to send;
 * never run here. A slash command must start the box, so a draft is refused rather than lost.
 */
async function fillResume($: Engine, sessionId: string): Promise<void> {
  await withPromptBox(async () => {
    const draft = (await $.prompt.read()).text
    if (draft.trim() !== '') throw new Error('the prompt box has a draft; clear it, then press Resume again')
    const text = `/resume ${sessionId}`
    const filled = await $.prompt.fill({ text, mode: 'replace' })
    if (!filled.isFilled) throw new Error('the prompt box did not take /resume')
    if (filled.text !== text) throw new Error('the prompt box changed while /resume was put in; check the draft')
  })
}

// --- Hooks ---------------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'follow-ups', description: 'Open the Follow-ups pane' })
    await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false })
    const id = await $.session.id()
    await update($, selfId, () => id)
    // Every session starts on its own items; the choice of view is not carried over.
    await update($, view, () => 'self' as const)
    await update($, ownState, () => null)
    await update($, bandScope, () => 'self' as const)
    await update($, paneArmed, () => true)
    const storedShowDone = await $.store.get(SHOW_DONE_KEY)
    if (typeof storedShowDone === 'boolean') await update($, showDone, () => storedShowDone)
    const storedClosed = await $.store.get(BAND_CLOSED_KEY)
    if (Array.isArray(storedClosed) && storedClosed.every(id => typeof id === 'string')) {
      const closed: string[] = storedClosed
      await update($, bandClosed, () => closed)
    }
    $.clock.after(1, () => runStep($, async () => {
      // A resumed session's file may still say 'ended' from its last run.
      await recordState($, 'idle')
      await loadFiles($)
      await checkOwnPr($)
    }))
    $.clock.every(REFRESH_MS, () => runStep($, () => loadFiles($)))
    return next(e)
  })

  on('command.run', { command: 'follow-ups' }, async $ => {
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    await setBandClosed($, null)
    runStep($, () => refresh($))
    return { text: COMMAND_RESULT }
  })

  // Literal matcher so validate can list which tool this hook answers.
  on('tool.call', { tool: 'mcp__follow-ups__pending_items_set' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { deny: subagentDeny(TOOL_FULL) }
    }
    const input = parseSetInput(e as unknown as Record<string, unknown>)
    if ('error' in input) return { deny: inputDeny(TOOL_FULL, input.error) }
    const { file, hidden } = await setItems($, input)
    // One line: the model already holds the list it sent; only hidden ids are news to it.
    const lines = [storedResult(file.items.length, file.title)]
    if (hidden.length > 0) {
      lines.push(hiddenResult(hidden))
    }
    return { result: lines.join(' ') }
  }).catch(($, e) => ({ deny: storeFailedDeny(TOOL_FULL) }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.traits.includes('teammate')) return composed
    return { sections: [...composed.sections, { id: `${PLUGIN}:instructions`, text: COMPOSE_TEXT, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  // Tells this session's model which of its items the person marked done, as context beside the
  // prompt (never shown in it). A failure lets the prompt in unchanged.
  on('prompt.submit', async ($, e, next) => {
    const notice = await takeDoneNotice($)
    return next(notice === undefined ? e : { ...e, context: [...(e.context ?? []), notice] })
  }).catch(($, e, next) => next(e))

  // The person closing the pane holds back the automatic open until this session's rows empty again.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, paneArmed, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A subagent's run raises no turn.start, so every one is the main loop's.
  on('turn.start', async ($, e, next) => {
    runStep($, async () => {
      await recordState($, 'running', { isTurnStart: true })
      await loadFiles($)
    })
    return next(e)
  })

  // Observes the verdict only: it is returned unchanged. An ask on a query or in a subagent's loop is not this session waiting.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.agentId === undefined && e.tool_use_id !== undefined) {
      runStep($, async () => {
        await recordState($, 'waiting_permission')
        await loadFiles($)
      })
    }
    return verdict
  }).catch(($, e, next) => next(e))

  // Once an asked call is settled (run or refused), the turn goes on: back to running.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && (await read($, ownState))?.state === 'waiting_permission') {
      runStep($, async () => {
        await recordState($, 'running')
        await loadFiles($)
      })
    }
    return result
  }).catch(($, e, next) => next(e))

  // Records the PRs a `gh pr create` printed, run by this session or a subagent of it, whatever
  // the repository. Observes only: the result is returned unchanged, and the lookup runs as a
  // background step, so its failure shows in the pane and never reaches the Bash call.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.isError !== true) {
      const urls = createdPrUrls(e.command, result.result.stdout)
      if (urls.length > 0) runStep($, () => recordCreatedPrs($, urls))
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      runStep($, async () => {
        await recordState($, stateAfterMainTurn(e.reason, e.reason === 'answer' && (await anyActiveAgent($))))
        await checkOwnPr($)
      })
    } else {
      // The last of them ending, with no turn started since, leaves the session as the answer did.
      const agentId = e.agentId
      runStep($, async () => {
        if ((await read($, ownState))?.state !== 'background' || (await anyActiveAgent($, agentId))) return
        await recordState($, STATE_AFTER.answer)
        await loadFiles($)
      })
    }
    return next(e)
  })

  // Awaited, not a background step: the process may exit right after; the chain's short bound covers it.
  on('session.end', async ($, e, next) => {
    await recordState($, 'ended', { sessionId: e.sessionId })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: 'follow-ups' }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const els: ViewElements = { Box, Text, Button, Link }
    const data = {
      state: await read($, files),
      self: await read($, selfId),
      mode: await read($, view),
      failure: await read($, fault),
      withDone: await read($, showDone),
      now: await $.clock.now(),
      isFocused: e.props.isFocused,
      surface: e.surface,
    }
    return paneView(els, data, {
      done: (sessionId, id, act) => runStep($, () => changeSession($, sessionId, act, (file, now) => dismissed(file, id, now))),
      undo: (sessionId, id, act) => runStep($, () => changeSession($, sessionId, act, file => undone(file, id))),
      copy: (item, surface) => runStep($, () => copyItem($, item, surface)),
      reply: item => runStep($, () => replyTo($, item)),
      answer: (item, option) => runStep($, () => answerWith($, item, option)),
      open: host => runStep($, () => openHostSession($, host)),
      resume: sessionId => runStep($, () => fillResume($, sessionId)),
      // A view switch also reloads, so archived sessions' files are cleared then too.
      choose: (chosen: PendingItemsView) => runStep($, async () => {
        await update($, view, () => chosen)
        keepFocus($, `view-${chosen}`)
        await loadFiles($)
      }),
      refresh: () => runStep($, () => refresh($)),
      // Flips the value as stored, not as drawn: a press on an older drawing must not set it back.
      toggleDone: () => runStep($, async () => {
        const shown = await update($, showDone, current => !current)
        keepFocus($, 'toggle-done')
        await $.store.set(SHOW_DONE_KEY, shown)
      }),
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const state = await read($, files)
    if (state.status !== 'ok') return next(e)
    if ((await read($, bandClosed)) !== null) return next(e)
    const allRows = state.files.flatMap(file => rowsOf(file, false))
    // Shown while any session has a row, whatever the scope, so the scope toggle stays reachable.
    if (allRows.length === 0) return next(e)
    const { Box, Button, Text, Link } = $.ui.resolve(e)
    const data = { allRows, self: await read($, selfId), scope: await read($, bandScope), surface: e.surface }
    return bandView({ Box, Button, Text, Link }, data, {
      toggleScope: () => runStep($, async () => {
        await update($, bandScope, current => current === 'self' ? 'all' : 'self')
      }),
      open: () => void $.ui.open({ id: PANE, title: PANE_TITLE }),
      close: ids => runStep($, () => setBandClosed($, ids)),
    })
  })
}
