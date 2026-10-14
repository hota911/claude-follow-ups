// The session state after each header.
import { describe, expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { SELF, TOOL, NOW, NO_PR, fileOf, world, start, mountPane } from './world'

describe('session state', () => {
  const item = { id: 'q1', kind: 'question' as const, text: 'What is the budget?' }

  test('each turn and the end are written to the session file without moving updatedAt', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [item] })])
    await start($, w)
    expect(w.file(SELF)).toMatchObject({ state: 'idle', stateAt: NOW + 1 })

    const before = w.file(SELF)?.updatedAt
    await w.clock.advance(100)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.settle()
    expect(w.file(SELF)).toMatchObject({ state: 'running', stateAt: NOW + 110 })
    expect(w.file(SELF)?.updatedAt).toBe(before)

    await $.turn.complete({ answer: 'stopped', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
    await w.clock.settle()
    expect(w.file(SELF)?.state).toBe('interrupted')

    await $.turn.start({ text: 'again', turnId: 't2' })
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    await w.clock.settle()
    expect(w.file(SELF)?.state).toBe('idle')

    await $.session.end({ reason: 'prompt_input_exit', sessionId: SELF } as Parameters<typeof $.session.end>[0])
    expect(w.file(SELF)?.state).toBe('ended')
  })

  test('a permission dialog in the main loop is Needs permission; one in a subagent is not', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [item] })])
    // No settings hook decides, so the dialog is shown.
    on('classic.PermissionRequest', () => ({}))
    await start($, w)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.settle()

    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'agent-1' })
    await w.clock.settle()
    expect(w.file(SELF)?.state).toBe('running')

    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    await w.clock.settle()
    expect(w.file(SELF)?.state).toBe('waiting_permission')
  })

  test('a state alone does not create a file', async ($, on) => {
    const w = world(on, NO_PR)
    await start($, w)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.settle()
    expect(w.file(SELF)).toBeUndefined()
    // The first list stored carries the state.
    await $.tool.call({ tool: TOOL, title: 'Mine', items: [item] })
    expect(w.file(SELF)?.state).toBe('running')
  })

  test('the session header shows the state; an old one is shown as stale', async ($, on) => {
    const day = 24 * 3600 * 1000
    const w = world(on, NO_PR, [
      fileOf('session-b', { title: 'Fresh', updatedAt: NOW - 1, state: 'waiting_permission', stateAt: NOW - 1000, items: [{ ...item, id: 'b' }] }),
      fileOf('session-c', { title: 'Old', updatedAt: NOW - 2, state: 'running', stateAt: NOW - 2 * day, items: [{ ...item, id: 'c' }] }),
      fileOf('session-d', { title: 'Gone', updatedAt: NOW - 3, state: 'ended', stateAt: NOW - 3 * day, items: [{ ...item, id: 'd' }] }),
    ])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'view-session' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: 'Needs permission' })).toMatchObject({ props: { color: 'warning' } })
    expect(await pane.find({ type: 'Text', text: 'stale?' })).toMatchObject({ props: { dimColor: true } })
    expect(await pane.find({ type: 'Text', text: 'Ended' })).toMatchObject({ props: { dimColor: true } })
    await pane.unmount()
  })

  test('the activity shows dim next to Running, not Waiting for you, and a new turn clears it', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [item] })])
    await start($, w)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.settle()
    await $.tool.call({ tool: TOOL, title: 'Mine', activity: '  Writing the tests  ', items: [item] })
    await w.clock.settle()
    expect(w.file(SELF)?.activity).toBe('Writing the tests')
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface, true)
      expect(await pane.find({ type: 'Text', text: 'Running' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: ' Writing the tests' })).toMatchObject({ props: { dimColor: true } })
      await pane.unmount()
    }

    // Waiting for you: the activity is kept in the file but not shown.
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.settle()
    expect(w.file(SELF)?.state).toBe('idle')
    const idle = await mountPane($)
    expect(await idle.find({ type: 'Text', text: / Writing the tests/ })).toBeUndefined()
    await idle.unmount()

    // Running again in a new turn: the last turn's activity is gone.
    await $.turn.start({ text: 'again', turnId: 't2' })
    await w.clock.settle()
    expect(w.file(SELF)?.activity).toBeUndefined()
    const running = await mountPane($)
    expect(await running.find({ type: 'Text', text: 'Running' })).toBeDefined()
    expect(await running.find({ type: 'Text', text: / Writing the tests/ })).toBeUndefined()
    await running.unmount()

    // A call without it removes it.
    await $.tool.call({ tool: TOOL, title: 'Mine', activity: 'Reading', items: [item] })
    await $.tool.call({ tool: TOOL, title: 'Mine', items: [item] })
    expect(w.file(SELF)?.activity).toBeUndefined()
  })

  test('an activity under a stale Running is not shown', async ($, on) => {
    const w = world(on, NO_PR, [
      fileOf('session-b', { title: 'Old', state: 'running', stateAt: NOW - 2 * 24 * 3600 * 1000, activity: 'Long gone', items: [{ ...item, id: 'b' }] }),
    ])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'view-session' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: 'stale?' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: / Long gone/ })).toBeUndefined()
    await pane.unmount()
  })

  describe('subagents running after the answer', () => {
    const agent = (id: string, fields: Partial<AgentInfo> = {}): AgentInfo => (
      { id, description: `Task ${id}`, type: 'general-purpose', status: 'running', ...fields }
    )
    const answer = (turnId: string, agentId?: string) => ({
      answer: 'done', durationMs: 1, isAborted: false, turnId, reason: 'answer' as const, ...(agentId !== undefined ? { agentId } : {}),
    })

    test('an answer with an active subagent records Background task running, shown with the activity', async ($, on) => {
      const w = world(on, NO_PR, [fileOf(SELF, { items: [item] })])
      await start($, w)
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.tool.call({ tool: TOOL, title: 'Mine', activity: 'Waiting on the review agent', items: [item] })
      w.agents.push(agent('a1'), agent('a0', { status: 'completed' }))
      await $.turn.complete(answer('t1'))
      await w.clock.settle()
      expect(w.file(SELF)?.state).toBe('background')
      const pane = await mountPane($, 'desktop', true)
      expect(await pane.find({ type: 'Text', text: 'Background task running' })).toMatchObject({ props: { color: 'permission' } })
      expect(await pane.find({ type: 'Text', text: ' Waiting on the review agent' })).toMatchObject({ props: { dimColor: true } })
      await pane.unmount()
    })

    test('only agents the main loop started count, and ended or idle ones do not', async ($, on) => {
      const w = world(on, NO_PR, [fileOf(SELF, { items: [item] })])
      await start($, w)
      w.agents.push(agent('n1', { parentId: 'a0' }), agent('a0', { status: 'completed' }), agent('t1', { status: 'idle' }))
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.turn.complete(answer('t1'))
      await w.clock.settle()
      expect(w.file(SELF)?.state).toBe('idle')
    })

    test('the last subagent ending records Waiting for you; an earlier one does not', async ($, on) => {
      const w = world(on, NO_PR, [fileOf(SELF, { items: [item] })])
      await start($, w)
      w.agents.push(agent('a1'), agent('a2'))
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.turn.complete(answer('t1'))
      await w.clock.settle()
      expect(w.file(SELF)?.state).toBe('background')

      // a1 is still listed as running while its own turn ends.
      await $.turn.complete(answer('s1', 'a1'))
      await w.clock.settle()
      expect(w.file(SELF)?.state).toBe('background')

      w.agents[0]!.status = 'completed'
      await $.turn.complete(answer('s2', 'a2'))
      await w.clock.settle()
      expect(w.file(SELF)?.state).toBe('idle')
    })

    test('a subagent ending during a main-loop turn leaves Running alone', async ($, on) => {
      const w = world(on, NO_PR, [fileOf(SELF, { items: [item] })])
      await start($, w)
      w.agents.push(agent('a1'))
      await $.turn.start({ text: 'go', turnId: 't1' })
      await w.clock.settle()
      await $.turn.complete(answer('s1', 'a1'))
      await w.clock.settle()
      expect(w.file(SELF)?.state).toBe('running')
    })

    test('an aborted main turn records Interrupted even with an active subagent', async ($, on) => {
      const w = world(on, NO_PR, [fileOf(SELF, { items: [item] })])
      await start($, w)
      w.agents.push(agent('a1'))
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.turn.complete({ answer: 'stopped', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
      await w.clock.settle()
      expect(w.file(SELF)?.state).toBe('interrupted')
    })
  })
})
