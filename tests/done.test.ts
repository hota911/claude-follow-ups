// ✓ and ↺: marking items and PRs done, Show done and Undo, the expiry of done entries, and where
// the focus goes after a press.
import { describe, expect, test } from 'claude-code/testing'

import type { PendingItemsSessionFile } from '../types'
import { focusAfter, type Shown } from '../hooks/rows'
import { SELF, TOOL, NOW, NO_PR, prJson, fileOf, world, start, mountPane } from './world'

describe('Done', () => {
  test('a dismissed id stays hidden when the model sends it again', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { title: 'Research', items: [
      { id: 'q1', kind: 'question', text: 'What is the budget?' },
      { id: 'u1', kind: 'user_action', text: 'Send the invoice' },
    ] })])
    await start($, w)

    const pane = await mountPane($)
    const done = await pane.find({ type: 'Button', key: `act:${SELF}:q1` })
    expect(done?.props.label).toBe('✓')
    expect(done?.props.plain).toBeUndefined()
    await pane.press({ key: `act:${SELF}:q1` })
    await w.clock.settle()
    expect(w.file(SELF)?.dismissed).toEqual(['q1'])
    expect(await pane.find({ type: 'Text', text: /budget/ })).toBeUndefined()
    await pane.unmount()

    const ran = await $.tool.call({ tool: TOOL, title: 'Research', items: [
      { id: 'q1', kind: 'question', text: 'What is the budget?' },
      { id: 'u1', kind: 'user_action', text: 'Send the invoice' },
    ] })
    expect(ran.result).toBe('Stored 1 item(s) for "Research". The user already marked these ids done, so they stay hidden: q1. Use a new id only for genuinely new work.\nCurrent: u1 (user_action).')
    expect(w.file(SELF)?.items.map(i => i.id)).toEqual(['u1'])
  })

  test('Show done reveals a done item, and Undo puts it back', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { title: 'Research', items: [
      { id: 'q1', kind: 'question', text: 'What is the budget?' },
      { id: 'u1', kind: 'user_action', text: 'Send the invoice' },
    ] })])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: `act:${SELF}:q1` })
    await w.clock.settle()
    expect(w.file(SELF)?.done).toEqual([{ id: 'q1', doneAt: NOW + 10, item: { id: 'q1', kind: 'question', text: 'What is the budget?' } }])
    expect(await pane.find({ type: 'Button', key: 'toggle-done' })).toMatchObject({ props: { label: '☐ Show done (1)' } })

    await pane.press({ key: 'toggle-done' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Button', key: 'toggle-done' })).toMatchObject({ props: { label: '☑ Show done (1)' } })
    expect(await pane.find({ type: 'Text', text: 'What is the budget?' })).toMatchObject({ props: { dimColor: true, strikethrough: true } })
    // Header counts only active rows.
    expect(await pane.find({ type: 'Text', text: 'Questions for you (0)' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: `act:${SELF}:q1` })).toMatchObject({ props: { label: '↺' } })

    await pane.press({ key: `act:${SELF}:q1` })
    await w.clock.settle()
    expect(w.file(SELF)?.dismissed).toEqual([])
    expect(w.file(SELF)?.done).toEqual([])
    expect(w.file(SELF)?.items.map(i => i.id)).toEqual(['u1', 'q1'])
    expect(await pane.find({ type: 'Button', key: `act:${SELF}:q1` })).toMatchObject({ props: { label: '✓' } })
    expect(await pane.find({ type: 'Text', text: 'What is the budget?' })).toMatchObject({ props: { wrap: 'wrap' } })
    expect((await pane.find({ type: 'Text', text: 'What is the budget?' }))?.props.strikethrough).toBeUndefined()
    await pane.unmount()

    // After Undo the model may send it again and it shows normally.
    const ran = await $.tool.call({ tool: TOOL, title: 'Research', items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] })
    expect(String(ran.result)).not.toContain('stay hidden')
    expect(w.file(SELF)?.items.map(i => i.id)).toEqual(['q1'])

    // The toggle is remembered across a restart.
    await start($, w)
    const again = await mountPane($)
    expect(await again.find({ type: 'Button', key: 'toggle-done' })).toMatchObject({ props: { label: '☑ Show done (0)' } })
    await again.unmount()
  })

  test('one press redraws at once, with no further press or tick', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { title: 'Research', items: [
      { id: 'q1', kind: 'question', text: 'What is the budget?' },
      { id: 'u1', kind: 'user_action', text: 'Send the invoice' },
    ] })])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: `act:${SELF}:q1` })
    expect(await pane.find({ type: 'Text', text: /budget/ })).toBeUndefined()
    expect(await pane.find({ type: 'Button', key: 'toggle-done' })).toMatchObject({ props: { label: '☐ Show done (1)' } })
    await pane.press({ key: 'toggle-done' })
    expect(await pane.find({ type: 'Button', key: 'toggle-done' })).toMatchObject({ props: { label: '☑ Show done (1)' } })
    await pane.press({ key: `act:${SELF}:q1` })
    expect(await pane.find({ type: 'Button', key: `act:${SELF}:q1` })).toMatchObject({ props: { label: '✓' } })
    await pane.press({ key: 'toggle-done' })
    expect(await pane.find({ type: 'Button', key: 'toggle-done' })).toMatchObject({ props: { label: '☐ Show done (0)' } })
    await pane.unmount()
  })

  test('a PR check running across a press does not undo the press', async ($, on) => {
    const w = world(on, () => ({ exitCode: 0, stdout: prJson('OPEN'), stderr: '' }), [fileOf(SELF, { title: 'Research', items: [
      { id: 'q1', kind: 'question', text: 'What is the budget?' },
    ] })])
    await start($, w)
    let release = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    w.setGh(async () => {
      await held
      return { exitCode: 0, stdout: prJson('OPEN'), stderr: '' }
    })
    const pane = await mountPane($)
    const check = $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await pane.press({ key: `act:${SELF}:q1` })
    expect(await pane.find({ type: 'Text', text: /budget/ })).toBeUndefined()
    release()
    await check
    await w.clock.settle()
    expect(w.file(SELF)?.dismissed).toEqual(['q1'])
    expect(w.file(SELF)?.prs.map(p => p.number)).toEqual([42])
    expect(await pane.find({ type: 'Text', text: /budget/ })).toBeUndefined()
    await pane.unmount()
  })

  test('a done PR can be undone, and done entries expire after 7 days', async ($, on) => {
    const w = world(on, () => ({ exitCode: 0, stdout: prJson('OPEN'), stderr: '' }))
    await start($, w)
    const pr = 'pr:https://github.com/o/project/pull/42'
    const pane = await mountPane($)
    await pane.press({ key: `act:${SELF}:${pr}` })
    await w.clock.settle()
    expect(w.file(SELF)?.prs).toEqual([])
    expect(w.file(SELF)?.pr).toBeUndefined()
    // Only a done entry is left; the file is kept for it.
    expect(w.file(SELF)?.done.map(d => d.id)).toEqual([pr])
    await pane.press({ key: 'toggle-done' })
    await w.clock.settle()
    await pane.press({ key: `act:${SELF}:${pr}` })
    await w.clock.settle()
    expect(w.file(SELF)?.prs.map(p => p.number)).toEqual([42])
    expect(w.file(SELF)?.dismissed).toEqual([])
    await pane.unmount()
  })

  const day = 24 * 3600 * 1000
  const oldItem = { id: 'q1', kind: 'question' as const, text: 'Old' }

  test('done entries older than 7 days are pruned; recent ones keep the file', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { dismissed: ['q1', 'q2'], done: [
      { id: 'q1', doneAt: NOW - 8 * day, item: oldItem },
      { id: 'q2', doneAt: NOW - 6 * day, item: { ...oldItem, id: 'q2', text: 'Recent' } },
    ] })])
    await start($, w)
    expect(w.file(SELF)?.done.map(d => d.id)).toEqual(['q2'])
  })

  test('a file left with only expired done entries is kept empty and not shown', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { dismissed: ['q1'], done: [{ id: 'q1', doneAt: NOW - 8 * day, item: oldItem }] })])
    await start($, w)
    expect(w.file(SELF)?.done).toEqual([])
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: 'Nothing pending' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'toggle-done' })).toMatchObject({ props: { label: '☐ Show done (0)' } })
    await pane.unmount()
  })
})

// The test kit does not answer a plugin's `$.ui.focus` (a press reaches "no implementation for
// ui.focus" even with a `ui.focus` hook here), so these check the key the press hands it.
describe('focus after ✓', () => {
  const q1 = { id: 'q1', kind: 'question' as const, text: 'What is the budget?' }
  const q2 = { id: 'q2', kind: 'question' as const, text: 'Which venue?' }
  const self = (mode: Shown['mode'], withDone = false): Shown => ({ self: SELF, mode, withDone })
  /** The file after ✓ on `id`, as the press leaves it. */
  const doneOn = (file: PendingItemsSessionFile, id: string): PendingItemsSessionFile => {
    const item = file.items.find(i => i.id === id)!
    return { ...file, items: file.items.filter(i => i.id !== id), dismissed: [...file.dismissed, id], done: [{ id, doneAt: NOW, item }, ...file.done] }
  }

  test('a row that leaves the drawing hands the focus to the next row', () => {
    const before = fileOf(SELF, { items: [q1, q2] })
    expect(focusAfter([before], [doneOn(before, 'q1')], self('self'), `act:${SELF}:q1`)).toBe(`act:${SELF}:q2`)
  })

  test('the last row hands it to the previous row', () => {
    const before = fileOf(SELF, { items: [q1, q2] })
    expect(focusAfter([before], [doneOn(before, 'q2')], self('self'), `act:${SELF}:q2`)).toBe(`act:${SELF}:q1`)
  })

  test('the only row hands it to the selected view tab', () => {
    const before = fileOf(SELF, { items: [q1] })
    expect(focusAfter([before], [doneOn(before, 'q1')], self('self'), `act:${SELF}:q1`)).toBe('view-self')
    expect(focusAfter([before], [doneOn(before, 'q1')], self('kind'), `act:${SELF}:q1`)).toBe('view-kind')
  })

  test('with Show done on, the row stays and keeps the focus as ↺', () => {
    const before = fileOf(SELF, { items: [q1, q2] })
    expect(focusAfter([before], [doneOn(before, 'q1')], self('self', true), `act:${SELF}:q1`)).toBe(`act:${SELF}:q1`)
  })

  test('the next row is the next one drawn: by kind, the next group across sessions', () => {
    const mine = fileOf(SELF, { items: [{ id: 'n1', kind: 'next_step', text: 'Merge it' }] })
    const other = fileOf('session-b', { items: [q1] })
    // By kind draws Questions (session-b's q1) before Next steps (this session's n1).
    expect(focusAfter([mine, other], [mine, doneOn(other, 'q1')], self('kind'), 'act:session-b:q1')).toBe(`act:${SELF}:n1`)
    // By session draws this session's box first, so n1 is before q1 there.
    expect(focusAfter([mine, other], [mine, doneOn(other, 'q1')], self('session'), 'act:session-b:q1')).toBe(`act:${SELF}:n1`)
  })
})
