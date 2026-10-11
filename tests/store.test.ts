// The session files: the tool, the done notice, the automatic open, archived sessions.
import { describe, expect, test, type Engine } from 'claude-code/testing'

import { parseSetInput } from '../hooks/parse'
import { DIR, SELF, TOOL, NOW, NO_PR, fileOf, world, start, mountPane } from './world'

describe('parse', () => {
  test('refuses an unknown kind and duplicated ids', () => {
    expect(parseSetInput({ title: 't', items: [{ id: 'a', kind: 'todo', text: 'x' }] })).toMatchObject({ error: expect.stringContaining('kind') })
    expect(parseSetInput({ title: 't', items: [{ id: 'a', kind: 'question', text: 'x' }, { id: 'a', kind: 'question', text: 'y' }] }))
      .toMatchObject({ error: expect.stringContaining('duplicated') })
  })

  test('takes 2-4 short distinct options on a question, trimmed, and refuses any other options', () => {
    const question = (options: unknown) => parseSetInput({ title: 't', items: [{ id: 'q', kind: 'question', text: 'Merge?', options }] })
    expect(question([' Yes ', 'No'])).toEqual({ title: 't', items: [{ id: 'q', kind: 'question', text: 'Merge?', options: ['Yes', 'No'] }] })
    expect(question(['A', 'B', 'C', 'D'])).toMatchObject({ items: [{ options: ['A', 'B', 'C', 'D'] }] })
    const refused = { error: expect.stringContaining('items[0].options is only for kind question') }
    for (const bad of [['Yes'], ['A', 'B', 'C', 'D', 'E'], ['Yes', 'x'.repeat(41)], ['Yes', 'yes ', 'Yes'], ['Yes', 'Yes'], ['Yes', 1], ['Yes', ''], ['Yes', 'a\nb'], 'Yes']) {
      expect(question(bad)).toEqual(refused)
    }
    expect(parseSetInput({ title: 't', items: [{ id: 'u', kind: 'user_action', text: 'Send it', options: ['Done', 'Later'] }] })).toEqual(refused)
  })
})

describe('the tool', () => {
  test('replaces the whole list, and an empty list leaves an empty file that is not shown', async ($, on) => {
    const w = world(on, NO_PR)
    await start($, w)

    const first = await $.tool.call({ tool: TOOL, title: 'Tidy the logs', items: [
      { id: 'ask-date', kind: 'question', text: 'Pick a publish date' },
      { id: 'merge', kind: 'next_step', text: 'Merge the PR', owner: 'you' },
    ] })
    expect(first.deny).toBeUndefined()
    expect(w.file(SELF)?.items.map(i => i.id)).toEqual(['ask-date', 'merge'])

    const second = await $.tool.call({ tool: TOOL, title: 'Tidy the logs', items: [
      { id: 'merge', kind: 'next_step', text: 'Merge the PR', owner: 'you' },
    ] })
    expect(second.result).toBe('Stored 1 item(s) for "Tidy the logs".')
    expect(w.file(SELF)?.items.map(i => i.id)).toEqual(['merge'])

    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: 'Merge the PR (owner: you)' })).toMatchObject({
      children: ['Merge the PR', { props: { dimColor: true }, children: [' (owner: you)'] }],
    })
    expect(await pane.find({ type: 'Text', text: /publish date/ })).toBeUndefined()
    await pane.unmount()

    await $.tool.call({ tool: TOOL, title: 'Tidy the logs', items: [] })
    expect(w.file(SELF)?.items).toEqual([])
    const empty = await mountPane($)
    expect(await empty.find({ type: 'Text', text: 'Nothing pending' })).toBeDefined()
    expect(await empty.find({ type: 'Text', text: /Tidy the logs/ })).toBeUndefined()
    await empty.unmount()
  })

  test('refuses invalid input', async ($, on) => {
    const w = world(on, NO_PR)
    await start($, w)
    const ran = await $.tool.call({ tool: TOOL, title: 'x', items: [{ id: 'a', kind: 'later', text: 'y' }] })
    expect(ran.deny).toContain('kind must be one of')
    expect(w.file(SELF)).toBeUndefined()
  })

  test('stores a question\'s options, and refuses options on another kind', async ($, on) => {
    const w = world(on, NO_PR)
    await start($, w)
    const refused = await $.tool.call({ tool: TOOL, title: 'x', items: [{ id: 'n', kind: 'next_step', text: 'Merge', options: ['Now', 'Later'] }] })
    expect(refused.deny).toContain('items[0].options is only for kind question')
    expect(w.file(SELF)).toBeUndefined()
    const stored = await $.tool.call({ tool: TOOL, title: 'x', items: [{ id: 'q', kind: 'question', text: 'Merge now?', options: ['Yes', 'No'] }] })
    expect(stored.deny).toBeUndefined()
    expect(w.file(SELF)?.items).toEqual([{ id: 'q', kind: 'question', text: 'Merge now?', options: ['Yes', 'No'] }])
  })

  test('the system prompt section is fixed text, the same whatever is stored', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { title: 'Research', items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }], dismissed: ['old'] })])
    await start($, w)
    const compose = async () => {
      const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
      return sections.find(s => s.id === 'follow-ups:instructions')
    }
    const own = await compose()
    expect(own?.scope).toBe('session')
    expect(own?.text).toContain('in the language the user is using in this session')
    expect(own?.text).toContain('can do right now')
    expect(own?.text).toContain('is a next_step with the user as owner')
    expect(own?.text).toContain('Ids the user marked done stay hidden')
    expect(own?.text).not.toContain('What is the budget?')

    await $.tool.call({ tool: TOOL, title: 'Other', items: [{ id: 'n1', kind: 'next_step', text: 'Merge it', owner: 'you' }] })
    expect((await compose())?.text).toBe(own?.text)
  })
})

describe('done notice', () => {
  const NOTICE = '[Follow-ups] The user marked these done in the pane: q1 (What is the budget?)'
  /** The person pressing Enter at the prompt. */
  const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  test('✓ then a prompt: the model reads one line beside the prompt, once', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] })])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: `act:${SELF}:q1` })
    await w.clock.settle()
    await pane.unmount()

    const first = await submit($, 'Next task')
    expect(first).toMatchObject({ text: 'Next task', context: [NOTICE] })
    expect(w.file(SELF)?.notify).toBeUndefined()
    const second = await submit($, 'And another')
    expect(second.context ?? []).toEqual([])
  })

  test('✓ then ↺ then a prompt: nothing is added', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] })])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: `act:${SELF}:q1` })
    await w.clock.settle()
    await pane.press({ key: 'toggle-done' })
    await w.clock.settle()
    await pane.press({ key: `act:${SELF}:q1` })
    await w.clock.settle()
    await pane.unmount()

    const submitted = await submit($, 'Next task')
    expect(submitted.context ?? []).toEqual([])
  })

  test('✓ pressed in another session\'s pane is stored in the owner\'s file and told at its next prompt', async ($, on) => {
    const w = world(on, NO_PR, [
      fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] }),
      fileOf('session-b', { items: [{ id: 'q2', kind: 'question', text: 'Which venue?' }] }),
    ])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'view-kind' })
    await w.clock.settle()
    await pane.press({ key: 'act:session-b:q2' })
    await w.clock.settle()
    await pane.unmount()
    expect(w.file('session-b')?.notify).toEqual(['q2'])
    // This session's own prompt does not take another session's notice.
    expect((await submit($, 'Here')).context ?? []).toEqual([])
    expect(w.file('session-b')?.notify).toEqual(['q2'])

    // As session-b's pane left it for this session: a ✓ from elsewhere, told here.
    const mine = w.file(SELF)
    w.putFile(SELF, JSON.stringify({ ...mine, items: [], dismissed: ['q1'], notify: ['q1'],
      done: [{ id: 'q1', doneAt: NOW, item: { id: 'q1', kind: 'question', text: 'What is the budget?' } }] }))
    expect(await submit($, 'Next task')).toMatchObject({ context: [NOTICE] })
  })
})

describe('opening the pane', () => {
  const item = { id: 'q1', kind: 'question' as const, text: 'What is the budget?' }

  test('a session with nothing does not open it; storing items does, once until the list empties', async ($, on) => {
    const w = world(on, NO_PR, [fileOf('session-b', { items: [{ ...item, id: 'b' }] })])
    await start($, w)
    expect(w.panesOpened).toEqual([])

    await $.tool.call({ tool: TOOL, title: 'Mine', items: [item] })
    await w.clock.settle()
    expect(w.panesOpened).toEqual(['follow-ups'])
    await $.tool.call({ tool: TOOL, title: 'Mine', items: [item, { ...item, id: 'q2' }] })
    await w.clock.settle()
    expect(w.panesOpened).toEqual(['follow-ups'])

    await $.tool.call({ tool: TOOL, title: 'Mine', items: [] })
    await $.tool.call({ tool: TOOL, title: 'Mine', items: [{ ...item, id: 'q3' }] })
    await w.clock.settle()
    expect(w.panesOpened).toEqual(['follow-ups', 'follow-ups'])
  })

  test('a resumed session with items opens it at start', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [item] })])
    await start($, w)
    expect(w.panesOpened).toEqual(['follow-ups'])
  })
})

describe('archived Desktop sessions', () => {
  const item = { id: 'q', kind: 'question' as const, text: 'Which venue?' }
  const archived = JSON.stringify({ sessionId: 'local_b', isArchived: true })

  test('another session\'s file is deleted once its Desktop session is archived', async ($, on) => {
    const w = world(on, NO_PR, [fileOf('session-b', { hostSessionId: 'local_b', items: [item] })])
    w.putRecord('local_b', archived)
    await start($, w)
    expect(w.file('session-b')).toBeUndefined()
    expect(w.removed).toEqual([`${DIR}/session-b.json`])
    const pane = await mountPane($)
    await pane.press({ key: 'view-session' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: /Which venue/ })).toBeUndefined()
    await pane.unmount()
  })

  test('a file whose Desktop session is not archived, or has no readable record, is kept', async ($, on) => {
    const w = world(on, NO_PR, [
      fileOf('session-b', { hostSessionId: 'local_b', items: [item] }),
      fileOf('session-c', { hostSessionId: 'local_c', items: [item] }),
      fileOf('session-d', { hostSessionId: 'local_d', items: [item] }),
      fileOf('session-e', { hostSessionId: 'local_e', items: [item] }),
    ])
    w.putRecord('local_b', JSON.stringify({ isArchived: false }))
    w.putRecord('local_c', '{ not json')
    w.putRecord('local_d', JSON.stringify({ isArchived: 'true' }))
    await start($, w)
    for (const id of ['session-b', 'session-c', 'session-d', 'session-e']) expect(w.file(id)).toBeDefined()
    expect(w.removed).toEqual([])
  })

  test('this session\'s own file is never deleted, even when its Desktop session is archived', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { hostSessionId: 'local_self-1', items: [item] })], { CLAUDE_CODE_HOST_SESSION_ID: 'local_self-1' })
    w.putRecord('local_self-1', JSON.stringify({ isArchived: true }))
    await start($, w)
    await w.clock.advance(30 * 1000)
    await w.clock.settle()
    expect(w.file(SELF)?.items.map(i => i.id)).toEqual(['q'])
    expect(w.removed).toEqual([])
  })

  test('switching the view clears a session archived since the last load', async ($, on) => {
    const w = world(on, NO_PR, [fileOf('session-b', { hostSessionId: 'local_b', items: [item] })])
    w.putRecord('local_b', JSON.stringify({ isArchived: false }))
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'view-session' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: /Which venue/ })).toBeDefined()

    w.putRecord('local_b', archived)
    await pane.press({ key: 'view-kind' })
    await w.clock.settle()
    expect(w.file('session-b')).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /Which venue/ })).toBeUndefined()
    await pane.unmount()
  })
})
