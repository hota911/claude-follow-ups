// The drawings: the Follow-ups pane and the band above the prompt. Pure: register.tsx reads the
// state, resolves the elements and passes the handlers each button calls.
import type { Color, Elements, RenderElement, RenderSurface } from 'claude-code'

import type { PendingItem, PendingItemsLoad, PendingItemsSessionFile, PendingItemsSessionState, PendingItemsView } from '../types'
import { basename, STALE_STATE_MS } from './parse'
import { actKey, activeCount, bandIds, byGroup, type Group, GROUP_ORDER, type Row, rowId, rowsOf } from './rows'

const DONE_LABEL = '✓'
const UNDO_LABEL = '↺'
const COPY_LABEL = '⧉'
const SELF_MARK = ' (this session)'
const OPEN_LABEL = '↗'
const RESUME_LABEL = 'Resume'

const GROUP_LABEL: Record<Group, string> = {
  question: 'Questions for you',
  user_action: 'Your actions',
  pr: 'Open PRs',
  next_step: 'Next steps',
  unverified: 'Unverified / limits',
}
const BAND_LABEL: Record<Group, string> = {
  question: 'Questions',
  user_action: 'Your actions',
  pr: 'PRs',
  next_step: 'Next',
  unverified: 'Unverified',
}
// Theme keys, so each surface picks its own shade.
const GROUP_COLOR: Record<Group, Color> = {
  question: 'warning',
  user_action: 'claude',
  pr: 'merged',
  next_step: 'suggestion',
  unverified: 'planMode',
}

const STATE_LABEL: Record<PendingItemsSessionState, string> = {
  running: 'Running',
  background: 'Background task running',
  waiting_permission: 'Needs permission',
  idle: 'Waiting for you',
  interrupted: 'Interrupted',
  error: 'Error',
  ended: 'Ended',
}
// 'ended' has no color: it is drawn dim.
const STATE_COLOR: Record<Exclude<PendingItemsSessionState, 'ended'>, Color> = {
  running: 'suggestion',
  background: 'permission',
  waiting_permission: 'warning',
  idle: 'success',
  interrupted: 'subtle',
  error: 'error',
}

export type ViewElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Link'>

/** What a row's buttons do; each starts a background step. `act` is the pressed ✓/↺ control's key. */
export type RowHandlers = {
  done: (sessionId: string, id: string, act: string) => void
  undo: (sessionId: string, id: string, act: string) => void
  copy: (item: PendingItem, surface: RenderSurface) => void
  reply: (item: PendingItem) => void
  /** A question's choice button: sends `option` as this session's answer. */
  answer: (item: PendingItem, option: string) => void
  open: (hostSessionId: string) => void
  resume: (sessionId: string) => void
}

export type PaneHandlers = RowHandlers & {
  choose: (mode: PendingItemsView) => void
  refresh: () => void
  toggleDone: () => void
}

/** What the pane draws from. */
export type PaneData = {
  state: PendingItemsLoad
  self: string | null
  mode: PendingItemsView
  failure: string | null
  withDone: boolean
  now: number
  isFocused: boolean
  surface: RenderSurface
}

function sessionName(file: PendingItemsSessionFile): string {
  return file.title !== '' ? file.title : basename(file.cwd)
}

/** Text props spread into the pane's Texts: dim while the pane is not focused, nothing otherwise. */
type Fade = { dimColor?: true }

/**
 * One row: the buttons in a fixed column (✓ or ↺; on an active item also ⧉ to copy, then ↩ for this
 * session, or ↗ to open another (Resume for one with no Desktop id) when `withOpen`: the
 * session view puts ↗ or Resume in the session's
 * header instead), then a text column that shrinks and wraps, so wrapped lines hang under
 * the text. Top-aligned so the buttons sit on the first text line. `suffix` (the session
 * name) is drawn dim; done rows are dim and struck through. `fade` dims the rest while the pane
 * is not focused.
 */
function rowView(els: ViewElements, on: RowHandlers, self: string | null, row: Row, suffix: string, withOpen: boolean, fade: Fade): RenderElement {
  const { Box, Text, Button, Link } = els
  const id = rowId(row)
  const sessionId = row.file.sessionId
  // One key whether the row is active or done: ✓ and ↺ are one control, so a press that turns
  // one into the other keeps the element the focus ring is on.
  const act = actKey(sessionId, id)
  const host = row.file.hostSessionId
  const item = row.group === 'pr' ? undefined : row.item
  const extra: RenderElement[] = []
  if (!row.isDone && item !== undefined) {
    extra.push(<Text key="gap-copy"> </Text>, <Button key={`copy:${sessionId}:${id}`} label={COPY_LABEL} variant="secondary" onPress={press => on.copy(item, press.surface)} />)
    if (sessionId === self) {
      extra.push(<Text key="gap-reply"> </Text>, <Button key={`reply:${sessionId}:${id}`} label="↩" variant="secondary" onPress={() => on.reply(item)} />)
    } else if (withOpen && host !== undefined) {
      extra.push(<Text key="gap-open"> </Text>, <Button key={`open:${sessionId}:${id}`} label={OPEN_LABEL} variant="secondary" onPress={() => on.open(host)} />)
    } else if (withOpen) {
      extra.push(<Text key="gap-resume"> </Text>, <Button key={`resume:${sessionId}:${id}`} label={RESUME_LABEL} variant="secondary" onPress={() => on.resume(sessionId)} />)
    }
  }
  // A question of this session with options gets one button per option under its text; a press
  // sends the option as the answer at once.
  const question = !row.isDone && item !== undefined && item.kind === 'question' && sessionId === self ? item : undefined
  const choices = question?.options === undefined
    ? null
    : (
        <Box key="options" flexDirection="row" flexWrap="wrap">
          {question.options.flatMap((option, index) => [
            ...(index === 0 ? [] : [<Text key={`gap-answer:${index}`}> </Text>]),
            <Button key={`answer:${sessionId}:${id}:${index}`} label={option} variant="secondary" onPress={() => on.answer(question, option)} />,
          ])}
        </Box>
      )
  const dimSuffix = suffix === '' ? null : <Text dimColor>{suffix}</Text>
  const done = row.isDone ? { dimColor: true, strikethrough: true } : fade
  const body = row.group === 'pr'
    ? [
        <Box key="pr" flexDirection="row">
          <Box flexShrink={0}><Link href={row.pr.url} label={`#${row.pr.number}`} /><Text> </Text></Box>
          <Box flexShrink={1}>
            <Text wrap="wrap" {...done}>{row.pr.title}{row.pr.isDraft ? <Text dimColor> [draft]</Text> : null}{dimSuffix}</Text>
          </Box>
        </Box>,
      ]
    : [
        <Text key="text" wrap="wrap" {...done}>
          {row.item.text}
          {row.item.owner === undefined ? null : <Text dimColor>{` (owner: ${row.item.owner})`}</Text>}
          {dimSuffix}
        </Text>,
        row.item.url === undefined ? null : <Link key="url" href={row.item.url} label={row.item.url} />,
        choices,
      ]
  return (
    <Box key={`${sessionId}:${id}`} flexDirection="row" alignItems="flex-start" marginBottom={1}>
      <Box flexShrink={0} flexDirection="row">
        {row.isDone
          ? <Button key={act} label={UNDO_LABEL} variant="secondary" onPress={() => on.undo(sessionId, id, act)} />
          : <Button key={act} label={DONE_LABEL} variant="secondary" onPress={() => on.done(sessionId, id, act)} />}
        {extra}
        <Text> </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>{body}</Box>
    </Box>
  )
}

/** The Follow-ups pane: the view tabs and actions, then this session's box, every session's, or one box per kind. */
export function paneView(els: ViewElements, data: PaneData, on: PaneHandlers): RenderElement {
  const { Box, Text, Button } = els
  const { state, self, mode, failure, withDone, now } = data

  // Unfocused, every Text is drawn dim so the pane reads as inactive; Buttons keep their look
  // (on desktop they are native controls).
  const fade: Fade = data.isFocused ? {} : { dimColor: true }
  const rowLine = (row: Row, suffix: string, withOpen: boolean) => rowView(els, on, self, row, suffix, withOpen, fade)

  const groupHeader = (key: string, group: Group, count: number) => (
    <Text key={key} bold color={GROUP_COLOR[group]} {...fade}>{GROUP_LABEL[group]} ({count})</Text>
  )

  // The session's state after its header: dim when ended, or when so old the process may have died without saying so.
  // The activity follows Running and Background task running only: under any other state it
  // describes work no longer going on.
  const stateLabel = (file: PendingItemsSessionFile) => {
    if (file.state === undefined || file.stateAt === undefined) return null
    const isStale = now - file.stateAt > STALE_STATE_MS
    const label = file.state === 'ended'
      ? <Text key="state" dimColor>{STATE_LABEL.ended}</Text>
      : isStale
        ? <Text key="state" dimColor>stale?</Text>
        : <Text key="state" color={STATE_COLOR[file.state]} {...fade}>{STATE_LABEL[file.state]}</Text>
    const activity = (file.state === 'running' || file.state === 'background') && !isStale && file.activity !== undefined
      ? <Text key="activity" dimColor>{` ${file.activity}`}</Text>
      : null
    return [<Text key="state-gap"> </Text>, label, activity]
  }
  // One ↗ per other session, in its header: its rows all open the same session.
  const openButton = (sessionId: string, host: string) => [
    <Text key="open-gap"> </Text>,
    <Button key={`open:${sessionId}`} label={OPEN_LABEL} variant="secondary" onPress={() => on.open(host)} />,
  ]
  // A session with no Desktop id (a CLI one) gets Resume in the same place.
  const resumeButton = (sessionId: string) => [
    <Text key="resume-gap"> </Text>,
    <Button key={`resume:${sessionId}`} label={RESUME_LABEL} variant="secondary" onPress={() => on.resume(sessionId)} />,
  ]

  // A session with nothing to draw (only hidden done entries) is left out.
  const visible = (list: PendingItemsSessionFile[]) =>
    list.filter(file => rowsOf(file, withDone).length > 0 || file.prError !== undefined)

  const bySession = (list: PendingItemsSessionFile[]) => visible(list).map(file => {
    const rows = rowsOf(file, withDone)
    const isSelf = file.sessionId === self
    return (
      <Box
        key={file.sessionId}
        flexDirection="column"
        borderStyle="round"
        borderColor={isSelf ? 'claude' : 'subtle'}
        paddingX={1}
        marginTop={1}
      >
        <Box flexDirection="row" alignItems="flex-start">
          <Box flexShrink={1}>
            <Text bold wrap="wrap" {...fade}>{sessionName(file)} ({activeCount(rows)}){isSelf ? <Text dimColor>{SELF_MARK}</Text> : null}</Text>
          </Box>
          <Box flexShrink={0} flexDirection="row">
            {stateLabel(file)}
            {!isSelf && (file.hostSessionId !== undefined ? openButton(file.sessionId, file.hostSessionId) : resumeButton(file.sessionId))}
          </Box>
        </Box>
        <Text dimColor wrap="wrap">{basename(file.cwd)}{file.branch !== '' ? ` / ${file.branch}` : ''}</Text>
        {file.prError !== undefined && <Text color="error" wrap="wrap" {...fade}>PR check failed: {file.prError}</Text>}
        {byGroup(rows).map(({ group, rows: inGroup }) => (
          <Box key={`g:${file.sessionId}:${group}`} flexDirection="column" marginTop={1}>
            {groupHeader(`h:${file.sessionId}:${group}`, group, activeCount(inGroup))}
            <Box flexDirection="column" paddingLeft={2}>{inGroup.map(row => rowLine(row, '', false))}</Box>
          </Box>
        ))}
      </Box>
    )
  })

  const byKind = (list: PendingItemsSessionFile[]) => {
    const rows = list.flatMap(file => rowsOf(file, withDone))
    return byGroup(rows).map(({ group, rows: inGroup }) => (
      <Box
        key={`k:${group}`}
        flexDirection="column"
        borderStyle="round"
        borderColor={GROUP_COLOR[group]}
        paddingX={1}
        marginTop={1}
      >
        {groupHeader(`kh:${group}`, group, activeCount(inGroup))}
        <Box flexDirection="column" paddingLeft={2}>
          {inGroup.map(row => rowLine(row, ` — ${sessionName(row.file)}${row.file.sessionId === self ? SELF_MARK : ''}`, true))}
        </Box>
      </Box>
    ))
  }

  const all = state.status === 'ok' ? state.files : []
  const own = all.filter(file => file.sessionId === self)
  const others = all.filter(file => file.sessionId !== self)
  const doneCount = (mode === 'self' ? own : all).reduce((sum, file) => sum + file.done.length, 0)
  const othersActive = others.reduce((sum, file) => sum + rowsOf(file, false).length, 0)
  // 'self': this session's box as the session view draws it, or a pointer to the other sessions' items.
  const selfView = () => visible(own).length > 0
    ? bySession(own)
    : [
        <Text key="self-empty" dimColor>Nothing pending in this session</Text>,
        othersActive > 0 ? <Text key="self-others" dimColor>Other sessions: {othersActive}</Text> : null,
      ]

  // On desktop the first click only gives the pane the keyboard, so say whether it has it.
  const focusLine = data.isFocused
    ? <Text key="focus" color="subtle">● Focused</Text>
    : <Text key="focus" dimColor>{data.surface === 'desktop' ? 'Click to focus' : 'Click or ctrl+x tab to focus'}</Text>

  // View tabs on the left; the actions at the right end, plain and dim so they do not read as tabs.
  // A pane too narrow for both wraps the actions onto a second line instead of cutting them.
  return (
    <Box flexDirection="column">
      {focusLine}
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center">
        <Box flexDirection="row" flexShrink={1}>
          <Button key="view-self" label="This session" variant={mode === 'self' ? 'primary' : 'secondary'} onPress={() => on.choose('self')} />
          <Text> </Text>
          <Button key="view-session" label="By session" variant={mode === 'session' ? 'primary' : 'secondary'} onPress={() => on.choose('session')} />
          <Text> </Text>
          <Button key="view-kind" label="By kind" variant={mode === 'kind' ? 'primary' : 'secondary'} onPress={() => on.choose('kind')} />
        </Box>
        <Box flexDirection="row" flexShrink={0}>
          <Text>  </Text>
          <Button key="refresh" label="Refresh" plain dimColor onPress={() => on.refresh()} />
          <Text>  </Text>
          <Button key="toggle-done" label={`${withDone ? '☑' : '☐'} Show done (${doneCount})`} plain dimColor onPress={() => on.toggleDone()} />
        </Box>
      </Box>
      {failure !== null && <Text color="error" wrap="wrap" {...fade}>Failed: {failure}</Text>}
      {state.status === 'loading' && <Text dimColor>Loading…</Text>}
      {state.status === 'error' && <Text color="error" wrap="wrap" {...fade}>Cannot read session records: {state.message}</Text>}
      {state.status === 'ok' && mode !== 'self' && visible(all).length === 0 && <Text dimColor>Nothing pending</Text>}
      {state.status === 'ok' && (mode === 'self' ? selfView() : mode === 'session' ? bySession(all) : byKind(all))}
    </Box>
  )
}

export type BandData = { allRows: Row[]; self: string | null; scope: 'self' | 'all'; surface: RenderSurface }

export type BandHandlers = {
  toggleScope: () => void
  open: () => void
  close: (ids: string[]) => void
}

/** The band above the prompt: one line of counts with the scope, Open and close buttons. */
export function bandView(els: ViewElements, { allRows, self, scope, surface }: BandData, on: BandHandlers): RenderElement {
  const { Box, Button, Text } = els
  const rows = scope === 'all' ? allRows : allRows.filter(row => row.file.sessionId === self)
  // Every group in a fixed order, zeros included, so the line does not shift as counts change.
  const counts = GROUP_ORDER.map(group => ({ group, count: rows.filter(row => row.group === group).length }))
  const line = rows.length > 0
    ? counts.map(({ group, count }) => `${BAND_LABEL[group]} ${count}`).join(' · ')
    : `This session: nothing pending · Others ${allRows.length}`
  // On desktop the label is the native close control's accessible name; the terminal draws the label.
  const closeLabel = surface === 'desktop' ? 'Close' : '×'
  // Close records every session's listed ids, not only the scope's: reopenBandOnNew compares against
  // all sessions, so recording fewer would reopen the band at the next load.
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Box flexShrink={1}><Text dimColor wrap="wrap">{line}</Text></Box>
      <Box flexShrink={0} flexDirection="row" alignItems="center">
        <Text> </Text>
        <Button key="scope" label={scope === 'self' ? 'All sessions' : 'This session'} onPress={() => on.toggleScope()} />
        <Text> </Text>
        <Button key="open" label="Open" onPress={() => on.open()} />
        <Text> </Text>
        <Button key="close" label={closeLabel} role="dismiss" onPress={() => on.close(bandIds(allRows))} />
      </Box>
    </Box>
  )
}
