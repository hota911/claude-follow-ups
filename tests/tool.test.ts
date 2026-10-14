// The tool: how its input is checked, and what a call with items or changes stores and answers.
import { describe, expect, test } from 'claude-code/testing'

import { parseSetInput } from '../hooks/parse'
import { SELF, TOOL, NO_PR, fileOf, world, start, mountPane } from './world'

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

  test('strips terminal escape sequences and control characters, keeping newlines', () => {
    expect(parseSetInput({
      title: 'T\u001b[31mitle\u001b[0m',
      activity: 'Run\u0007ning',
      items: [{ id: 'a', kind: 'question', text: 'Pick\u001b]8;;https://x.test\u0007 one\r\n second\u009b', owner: 'yo\u0000u', options: ['Y\u001bes', 'No\u007f'] }],
    })).toEqual({
      title: 'Title',
      activity: 'Running',
      items: [{ id: 'a', kind: 'question', text: 'Pick one\n second', owner: 'you', options: ['Yes', 'No'] }],
    })
    expect(parseSetInput({ title: 't', items: [{ id: 'a\u001b', kind: 'question', text: 'x' }] })).toEqual({ error: 'items[0].id must be a non-empty string' })
  })

  test('takes only an http: or https: url on an item', () => {
    const withUrl = (url: string) => parseSetInput({ title: 't', items: [{ id: 'a', kind: 'user_action', text: 'Read it', url }] })
    expect(withUrl('https://example.com/docs?x=1#y')).toMatchObject({ items: [{ url: 'https://example.com/docs?x=1#y' }] })
    expect(withUrl('http://localhost:3000/')).toMatchObject({ items: [{ url: 'http://localhost:3000/' }] })
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'https://', 'http://', 'https://a b', 'HTTPS://example.com']) {
      expect(withUrl(bad)).toEqual({ error: 'items[0].url must be an http: or https: URL' })
    }
  })

  test('refuses input over the size limits instead of cutting it', () => {
    const item = { id: 'a', kind: 'question', text: 'x' }
    const items = (count: number) => Array.from({ length: count }, (_, index) => ({ ...item, id: `i${index}` }))
    expect(parseSetInput({ title: 't', items: items(50) })).toMatchObject({ items: expect.any(Array) })
    expect(parseSetInput({ title: 't', items: items(51) })).toEqual({ error: 'items must have at most 50 entries' })
    expect(parseSetInput({ title: 't'.repeat(121), items: [] })).toEqual({ error: 'title must be at most 120 characters' })
    expect(parseSetInput({ title: 't', activity: 'a'.repeat(121), items: [] })).toEqual({ error: 'activity must be at most 120 characters' })
    expect(parseSetInput({ title: 't', items: [{ ...item, id: 'i'.repeat(65) }] })).toEqual({ error: 'items[0].id must be at most 64 characters' })
    expect(parseSetInput({ title: 't', items: [{ ...item, text: 'x'.repeat(500) }] })).toMatchObject({ items: [{ text: 'x'.repeat(500) }] })
    expect(parseSetInput({ title: 't', items: [{ ...item, text: 'x'.repeat(501) }] })).toEqual({ error: 'items[0].text must be at most 500 characters' })
    expect(parseSetInput({ title: 't', items: [{ ...item, owner: 'o'.repeat(61) }] })).toEqual({ error: 'items[0].owner must be at most 60 characters' })
    expect(parseSetInput({ title: 't', items: [{ ...item, url: `https://example.com/${'p'.repeat(1981)}` }] }))
      .toEqual({ error: 'items[0].url must be at most 2000 characters' })
  })
})

describe('parse changes', () => {
  const item = { id: 'a', kind: 'question', text: 'x' }

  test('takes exactly one of items and changes', () => {
    const refused = { error: 'send exactly one of items (the full list) or changes (upsert and remove)' }
    expect(parseSetInput({ title: 't', items: [item], changes: { remove: ['b'] } })).toEqual(refused)
    expect(parseSetInput({ title: 't' })).toEqual(refused)
    expect(parseSetInput({ items: [item] })).toEqual({ error: 'title must be a string' })
    expect(parseSetInput({ changes: { upsert: [item] } })).toEqual({ changes: { upsert: [item], remove: [] } })
  })

  test('refuses duplicated ids, an id in both upsert and remove, and keys other than upsert and remove', () => {
    expect(parseSetInput({ changes: { upsert: [item, { ...item, text: 'y' }] } }))
      .toEqual({ error: 'changes.upsert[1].id "a" is duplicated' })
    expect(parseSetInput({ changes: { remove: ['b', 'b'] } })).toEqual({ error: 'changes.remove[1] "b" is duplicated' })
    expect(parseSetInput({ changes: { upsert: [item], remove: ['a'] } })).toEqual({ error: '"a" is in both changes.upsert and changes.remove' })
    expect(parseSetInput({ changes: { add: [item] } })).toEqual({ error: 'changes must be an object with only upsert and remove' })
  })

  test('checks upserts and removes as items and ids are checked', () => {
    expect(parseSetInput({ changes: { upsert: [{ ...item, kind: 'todo' }] } }))
      .toEqual({ error: 'changes.upsert[0].kind must be one of question, user_action, unverified, next_step' })
    expect(parseSetInput({ changes: { remove: ['i'.repeat(65)] } })).toEqual({ error: 'changes.remove[0] must be at most 64 characters' })
    expect(parseSetInput({ changes: { remove: [''] } })).toEqual({ error: 'changes.remove[0] must be a non-empty string' })
    expect(parseSetInput({ changes: { remove: Array.from({ length: 51 }, (_, index) => `i${index}`) } }))
      .toEqual({ error: 'changes.remove must have at most 50 entries' })
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
    expect(second.result).toBe('Stored 1 item(s) for "Tidy the logs".\nCurrent: merge (next_step).')
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

describe('the tool with changes', () => {
  const q1 = { id: 'q1', kind: 'question' as const, text: 'What is the budget?' }
  const u1 = { id: 'u1', kind: 'user_action' as const, text: 'Send the invoice' }
  const n1 = { id: 'n1', kind: 'next_step' as const, text: 'Merge the PR', owner: 'you' }

  test('upsert replaces an item in place and appends a new one; title and activity are kept when omitted', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { title: 'Research', activity: 'Reading the docs', items: [q1, u1] })])
    await start($, w)
    const ran = await $.tool.call({ tool: TOOL, changes: { upsert: [{ ...q1, text: 'What is the Q4 budget?' }, n1] } })
    expect(ran.result).toBe('Stored 3 item(s) for "Research".\nCurrent: q1 (question), u1 (user_action), n1 (next_step).')
    expect(w.file(SELF)).toMatchObject({
      title: 'Research',
      activity: 'Reading the docs',
      items: [{ ...q1, text: 'What is the Q4 budget?' }, u1, n1],
    })
  })

  test('a sent title and activity replace the stored ones, and an empty activity clears it', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { title: 'Research', activity: 'Reading the docs', items: [q1] })])
    await start($, w)
    await $.tool.call({ tool: TOOL, title: 'Budget', activity: 'Writing', changes: {} })
    expect(w.file(SELF)).toMatchObject({ title: 'Budget', activity: 'Writing', items: [q1] })
    await $.tool.call({ tool: TOOL, activity: '', changes: {} })
    expect(w.file(SELF)?.activity).toBeUndefined()
    expect(w.file(SELF)?.title).toBe('Budget')
  })

  test('remove drops ids and names the ones that were not in the list', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { title: 'Research', items: [q1, u1] })])
    await start($, w)
    const ran = await $.tool.call({ tool: TOOL, changes: { remove: ['q1', 'gone'] } })
    expect(ran.result).toBe('Stored 1 item(s) for "Research". Not in the list, so nothing to remove (already removed or marked done): gone.\n'
      + 'Current: u1 (user_action).')
    expect(w.file(SELF)?.items).toEqual([u1])
    const empty = await $.tool.call({ tool: TOOL, changes: { remove: ['u1'] } })
    expect(empty.result).toBe('Stored 0 item(s) for "Research".\nCurrent: none.')
  })

  test('a dismissed id sent in upsert stays hidden', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { title: 'Research', items: [u1], dismissed: ['q1'] })])
    await start($, w)
    const ran = await $.tool.call({ tool: TOOL, changes: { upsert: [q1] } })
    expect(ran.result).toBe('Stored 1 item(s) for "Research". The user already marked these ids done, so they stay hidden: q1. '
      + 'Use a new id only for genuinely new work.\nCurrent: u1 (user_action).')
    expect(w.file(SELF)?.items).toEqual([u1])
  })

  test('with no file yet, changes without a title is refused; with a title it stores the upserts', async ($, on) => {
    const w = world(on, NO_PR)
    await start($, w)
    const refused = await $.tool.call({ tool: TOOL, changes: { upsert: [q1] } })
    expect(refused.deny).toBe(`${TOOL}: nothing is stored for this session yet; send the full list with items and a title`)
    expect(w.file(SELF)).toBeUndefined()
    const stored = await $.tool.call({ tool: TOOL, title: 'Research', changes: { upsert: [q1], remove: ['old'] } })
    expect(stored.deny).toBeUndefined()
    expect(w.file(SELF)).toMatchObject({ title: 'Research', items: [q1] })
  })

  test('refuses a change that would make the list longer than 50 items, and leaves the file as it was', async ($, on) => {
    const many = Array.from({ length: 49 }, (_, index) => ({ ...q1, id: `q${index}` }))
    const w = world(on, NO_PR, [fileOf(SELF, { title: 'Research', items: many })])
    await start($, w)
    const ran = await $.tool.call({ tool: TOOL, changes: { upsert: [u1, n1] } })
    expect(ran.deny).toBe(`${TOOL}: the list would have 51 items; it can hold at most 50`)
    expect(w.file(SELF)?.items).toHaveLength(49)
    const replaced = await $.tool.call({ tool: TOOL, changes: { upsert: [u1, n1], remove: ['q0'] } })
    expect(replaced.deny).toBeUndefined()
    expect(w.file(SELF)?.items).toHaveLength(50)
  })
})
