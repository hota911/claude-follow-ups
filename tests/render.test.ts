// The pane and the band: ✓/↺, reply, focus, copy, the views, the band.
import { describe, expect, test, type Engine } from 'claude-code/testing'

import type { PendingItemsSessionFile } from '../types'
import { focusAfter, type Shown } from '../hooks/rows'
import { SELF, TOOL, NOW, NO_PR, prJson, fileOf, world, start, mountPane, mountBand } from './world'

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

describe('reply', () => {
  test('↩ quotes this session\'s question in the prompt box, keeping a draft', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] })])
    await start($, w)
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Button', key: `reply:${SELF}:q1` })).toMatchObject({ props: { label: '↩' } })
    await pane.press({ key: `reply:${SELF}:q1` })
    await w.clock.settle()
    expect(w.prompt.draft).toBe('> Question: What is the budget?\n\n')

    w.prompt.draft = 'Also check the logs'
    await pane.press({ key: `reply:${SELF}:q1` })
    await w.clock.settle()
    expect(w.prompt.draft).toBe('Also check the logs\n> Question: What is the budget?\n\n')
    // Desktop collapses newlines that an 'append' fill inserted, so every fill replaces the box.
    expect(w.prompt.modes).toEqual(['replace', 'replace'])

    w.prompt.draft = 'Line one\nline two\n'
    await pane.press({ key: `reply:${SELF}:q1` })
    await w.clock.settle()
    expect(w.prompt.draft).toBe('Line one\nline two\n> Question: What is the budget?\n\n')
    await pane.unmount()
  })

  test('two quick ↩ presses put both quotes in the box, in press order', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [
      { id: 'q1', kind: 'question', text: 'What is the budget?' },
      { id: 'u1', kind: 'user_action', text: 'Send the invoice' },
    ] })])
    await start($, w)
    const pane = await mountPane($)
    // Hold every read until both presses are in, so the second starts before the first has filled.
    let release = () => {}
    w.prompt.readGate = new Promise<void>(resolve => { release = resolve })
    await pane.press({ key: `reply:${SELF}:q1` })
    await pane.press({ key: `reply:${SELF}:u1` })
    release()
    await w.clock.settle()
    expect(w.prompt.draft).toBe('> Question: What is the budget?\n\n> Your action: Send the invoice\n\n')
    expect(await pane.find({ type: 'Text', text: /^Failed:/ })).toBeUndefined()
    await pane.unmount()
  })

  test('a box read back without the trailing newlines, as on Desktop, is no failure; one typed into is', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] })])
    await start($, w)
    const pane = await mountPane($)
    w.prompt.dropsTrailingNewlines = true
    w.prompt.draft = 'Also check the logs'
    await pane.press({ key: `reply:${SELF}:q1` })
    await w.clock.settle()
    expect(w.prompt.draft).toBe('Also check the logs\n> Question: What is the budget?')
    expect(await pane.find({ type: 'Text', text: /^Failed:/ })).toBeUndefined()

    w.prompt.typedDuringFill = 'x'
    await pane.press({ key: `reply:${SELF}:q1` })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: 'Failed: the prompt box changed while the quote was put in; check the draft' })).toBeDefined()
    await pane.unmount()
  })

  for (const surface of ['desktop', 'terminal'] as const) {
    test(`a question's option button sends the quoted question and the option, and marks it done (${surface})`, async ($, on) => {
      const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'Merge now?', options: ['Yes', 'No'] }] })])
      await start($, w)
      const pane = await mountPane($, surface)
      expect(await pane.find({ type: 'Button', key: `answer:${SELF}:q1:0` })).toMatchObject({ props: { label: 'Yes' } })
      expect(await pane.find({ type: 'Button', key: `answer:${SELF}:q1:1` })).toMatchObject({ props: { label: 'No' } })
      await pane.press({ key: `answer:${SELF}:q1:1` })
      await w.clock.settle()
      expect(w.submitted).toEqual(['> Question: Merge now?\n\nNo'])
      // The box is left alone; the question is done, kept for Show done and Undo.
      expect(w.prompt.draft).toBe('')
      expect(w.file(SELF)?.items).toEqual([])
      expect(w.file(SELF)?.dismissed).toEqual(['q1'])
      expect(await pane.find({ type: 'Button', key: `answer:${SELF}:q1:0` })).toBeUndefined()
      await pane.press({ key: 'toggle-done' })
      await w.clock.settle()
      expect(await pane.find({ type: 'Text', text: 'Merge now?' })).toMatchObject({ props: { strikethrough: true } })
      await pane.press({ key: `act:${SELF}:q1` })
      await w.clock.settle()
      expect(w.file(SELF)?.items.map(item => item.id)).toEqual(['q1'])
      expect(await pane.find({ type: 'Button', key: `answer:${SELF}:q1:0` })).toBeDefined()
      await pane.unmount()
    })
  }

  test('while the session is busy, the buttons are gone after one press, so one answer is sent', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'Merge now?', options: ['Yes', 'No'] }] })])
    await start($, w)
    const pane = await mountPane($)
    // The engine holds the submit until the turn running now ends.
    let idle = () => {}
    w.submits.gate = new Promise<void>(resolve => { idle = resolve })
    await pane.press({ key: `answer:${SELF}:q1:0` })
    await w.clock.settle()
    expect(await pane.find({ type: 'Button', key: `answer:${SELF}:q1:0` })).toBeUndefined()
    expect(await pane.find({ type: 'Button', key: `answer:${SELF}:q1:1` })).toBeUndefined()
    let pressedAgain = true
    try { await pane.press({ key: `answer:${SELF}:q1:0` }) } catch { pressedAgain = false }
    expect(pressedAgain).toBe(false)
    idle()
    await w.clock.settle()
    expect(w.submitted).toEqual(['> Question: Merge now?\n\nYes'])
    await pane.unmount()
  })

  test('two presses before the redraw send one answer', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'Merge now?', options: ['Yes', 'No'] }] })])
    await start($, w)
    const pane = await mountPane($)
    const first = pane.press({ key: `answer:${SELF}:q1:0` })
    const second = pane.press({ key: `answer:${SELF}:q1:1` }).catch(() => undefined)
    await Promise.all([first, second])
    await w.clock.settle()
    expect(w.submitted).toEqual(['> Question: Merge now?\n\nYes'])
    expect(w.file(SELF)?.done.map(entry => entry.id)).toEqual(['q1'])
    await pane.unmount()
  })

  test('a failed send puts the question back and says why', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'Merge now?', options: ['Yes', 'No'] }] })])
    await start($, w)
    const pane = await mountPane($)
    w.submits.fails = true
    await pane.press({ key: `answer:${SELF}:q1:0` })
    await w.clock.settle()
    expect(w.submitted).toEqual([])
    expect(w.file(SELF)?.items.map(item => item.id)).toEqual(['q1'])
    expect(w.file(SELF)?.dismissed).toEqual([])
    expect(w.file(SELF)?.done).toEqual([])
    expect(await pane.find({ type: 'Button', key: `answer:${SELF}:q1:0` })).toBeDefined()
    // The kit reports a throwing answer as the call having none.
    expect((await pane.find({ type: 'Text', text: /^Failed:/ }))?.text).toContain('prompt.submit')
    await pane.unmount()
  })

  test('option buttons are drawn only on this session\'s active questions', async ($, on) => {
    const w = world(on, NO_PR, [
      fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'Merge now?', options: ['Yes', 'No'] }] }),
      fileOf('session-b', { items: [{ id: 'q2', kind: 'question', text: 'Ship it?', options: ['Yes', 'No'] }] }),
    ])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'view-kind' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Button', key: `answer:${SELF}:q1:0` })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'answer:session-b:q2:0' })).toBeUndefined()
    await pane.press({ key: `act:${SELF}:q1` })
    await w.clock.settle()
    await pane.press({ key: 'toggle-done' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Button', key: `answer:${SELF}:q1:0` })).toBeUndefined()
    await pane.unmount()
  })

  test('every item kind gets ↩, led by its kind; the PR does not', async ($, on) => {
    const w = world(on, () => ({ exitCode: 0, stdout: prJson('OPEN'), stderr: '' }), [fileOf(SELF, { items: [
      { id: 'u1', kind: 'user_action', text: 'Send the invoice' },
      { id: 'n1', kind: 'next_step', text: 'Merge it', owner: 'you' },
      { id: 'v1', kind: 'unverified', text: 'Phone layout' },
    ] })])
    await start($, w)
    const pane = await mountPane($)
    for (const id of ['u1', 'n1', 'v1']) expect(await pane.find({ type: 'Button', key: `reply:${SELF}:${id}` })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: `reply:${SELF}:pr:https://github.com/o/project/pull/42` })).toBeUndefined()
    await pane.press({ key: `reply:${SELF}:n1` })
    await w.clock.settle()
    expect(w.prompt.draft).toBe('> Next step: Merge it\n\n')
    await pane.unmount()
  })

  test('another session\'s question links to that session instead', async ($, on) => {
    const w = world(on, NO_PR, [
      fileOf('session-b', { hostSessionId: 'local_abc-123', items: [{ id: 'q2', kind: 'question', text: 'Which venue?' }] }),
      fileOf('session-c', { items: [{ id: 'q3', kind: 'question', text: 'Which date?' }] }),
    ], { CLAUDE_CODE_HOST_SESSION_ID: 'local_self-1' })
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'view-session' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Button', key: 'reply:session-b:q2' })).toBeUndefined()
    // In the session view one ↗ per other session sits in its header, none on its rows.
    const opens = (await pane.findAll({ type: 'Button' })).map(b => b.key).filter(key => key?.startsWith('open:'))
    expect(opens).toEqual(['open:session-b'])
    expect(await pane.find({ type: 'Button', key: 'open:session-b' })).toMatchObject({ props: { label: '↗' } })
    await pane.press({ key: 'open:session-b' })
    await w.clock.settle()
    expect(w.opened).toEqual([['open', 'claude://claude.ai/epitaxy/local_abc-123']])

    // The kind view mixes sessions, so its rows keep their own ↗; still none without a Desktop id.
    await pane.press({ key: 'view-kind' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Button', key: 'open:session-b:q2' })).toMatchObject({ props: { label: '↗' } })
    expect(await pane.find({ type: 'Button', key: 'open:session-c:q3' })).toBeUndefined()
    await pane.unmount()

    await $.tool.call({ tool: TOOL, title: 'Mine', items: [{ id: 'm', kind: 'next_step', text: 'x' }] })
    expect(w.file(SELF)?.hostSessionId).toBe('local_self-1')
  })

  test('a CLI session gets Resume, which fills /resume <id> without running it and keeps a draft', async ($, on) => {
    const w = world(on, NO_PR, [
      fileOf('session-b', { hostSessionId: 'local_abc-123', items: [{ id: 'q2', kind: 'question', text: 'Which venue?' }] }),
      fileOf('session-c', { items: [{ id: 'q3', kind: 'question', text: 'Which date?' }] }),
      fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] }),
    ])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'view-session' })
    await w.clock.settle()
    // Only the CLI session: the Desktop one keeps ↗, this session gets neither.
    const resumes = (await pane.findAll({ type: 'Button' })).map(b => b.key).filter(key => key?.startsWith('resume:'))
    expect(resumes).toEqual(['resume:session-c'])
    expect(await pane.find({ type: 'Button', key: 'resume:session-c' })).toMatchObject({ props: { label: 'Resume' } })
    await pane.press({ key: 'resume:session-c' })
    await w.clock.settle()
    expect(w.prompt.draft).toBe('/resume session-c')

    // The kind view puts it on each of the CLI session's rows, as ↗ is placed.
    await pane.press({ key: 'view-kind' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Button', key: 'resume:session-c:q3' })).toMatchObject({ props: { label: 'Resume' } })
    expect(await pane.find({ type: 'Button', key: 'resume:session-b:q2' })).toBeUndefined()
    expect(await pane.find({ type: 'Button', key: `resume:${SELF}:q1` })).toBeUndefined()

    // A draft is not replaced: the press is refused with a message.
    w.prompt.draft = 'Half-written note'
    await pane.press({ key: 'resume:session-c:q3' })
    await w.clock.settle()
    expect(w.prompt.draft).toBe('Half-written note')
    expect(await pane.find({ type: 'Text', text: /Failed: the prompt box has a draft/ })).toBeDefined()
    await pane.unmount()
  })
})

describe('sending a reply', () => {
  /** The person pressing Enter at the prompt. */
  const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  test('↩ on a question, then sending the box, marks it done with no done notice; Undo puts it back', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [
      { id: 'q1', kind: 'question', text: 'What is the budget?\nIn euros' },
      { id: 'u1', kind: 'user_action', text: 'Send the invoice' },
    ] })])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: `reply:${SELF}:q1` })
    await w.clock.settle()
    const sent = await submit($, `${w.prompt.draft}About 5000`)
    await w.clock.settle()
    expect(sent.context ?? []).toEqual([])
    expect(w.file(SELF)?.items.map(item => item.id)).toEqual(['u1'])
    expect(w.file(SELF)?.done.map(entry => entry.id)).toEqual(['q1'])
    expect(w.file(SELF)?.notify).toBeUndefined()
    expect((await submit($, 'Next task')).context ?? []).toEqual([])

    await pane.press({ key: 'toggle-done' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: 'What is the budget?\nIn euros' })).toMatchObject({ props: { strikethrough: true } })
    await pane.press({ key: `act:${SELF}:q1` })
    await w.clock.settle()
    expect(w.file(SELF)?.items.map(item => item.id)).toEqual(['u1', 'q1'])
    expect(await pane.find({ type: 'Text', text: /^Failed:/ })).toBeUndefined()
    await pane.unmount()
  })

  test('several quoted questions in one prompt are all marked done', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [
      { id: 'q1', kind: 'question', text: 'What is the budget?' },
      { id: 'q2', kind: 'question', text: 'Which date?' },
    ] })])
    await start($, w)
    await submit($, 'Draft first\n> Question: What is the budget?\n\n5000\n> Question: Which date?\n\nMonday')
    await w.clock.settle()
    expect(w.file(SELF)?.items).toEqual([])
    expect(w.file(SELF)?.done.map(entry => entry.id)).toEqual(['q1', 'q2'])
  })

  test('a quoted user action, or an edited quote, leaves the item listed', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [
      { id: 'q1', kind: 'question', text: 'What is the budget?' },
      { id: 'u1', kind: 'user_action', text: 'Send the invoice' },
    ] })])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: `reply:${SELF}:u1` })
    await w.clock.settle()
    await submit($, `${w.prompt.draft}Sent`)
    await submit($, '> Question: What is the total budget?\n\n5000')
    await submit($, '> Question: What is the budget? And the date?\n\n5000, Monday')
    await w.clock.settle()
    expect(w.file(SELF)?.items.map(item => item.id)).toEqual(['q1', 'u1'])
    expect(w.file(SELF)?.done).toEqual([])
    await pane.unmount()
  })

  test('a prompt quoting another session\'s question leaves that session\'s file as it was', async ($, on) => {
    const w = world(on, NO_PR, [
      fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] }),
      fileOf('session-b', { items: [{ id: 'q2', kind: 'question', text: 'Which venue?' }] }),
    ])
    await start($, w)
    const before = w.raw('session-b')
    await submit($, '> Question: Which venue?\n\nThe hall')
    await w.clock.settle()
    expect(w.raw('session-b')).toBe(before)
    expect(w.file(SELF)?.items.map(item => item.id)).toEqual(['q1'])
  })

  test('a choice still sends exactly one answer and marks its question done once', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'Merge now?', options: ['Yes', 'No'] }] })])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: `answer:${SELF}:q1:0` })
    await w.clock.settle()
    expect(w.submitted).toEqual(['> Question: Merge now?\n\nYes'])
    expect(w.file(SELF)?.done).toEqual([{ id: 'q1', doneAt: NOW + 10, item: { id: 'q1', kind: 'question', text: 'Merge now?', options: ['Yes', 'No'] } }])
    expect(w.file(SELF)?.notify).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /^Failed:/ })).toBeUndefined()
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

describe('copy', () => {
  test('⧉ copies the first code span of an active item; PR and done rows have none', async ($, on) => {
    const w = world(on, () => ({ exitCode: 0, stdout: prJson('OPEN'), stderr: '' }), [fileOf(SELF, {
      items: [{ id: 'u1', kind: 'user_action', text: 'Run `uv sync` then `make test`' }],
      done: [{ id: 'q0', doneAt: NOW, item: { id: 'q0', kind: 'question', text: 'Old question' } }],
    })])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'toggle-done' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Button', key: `copy:${SELF}:u1` })).toMatchObject({ props: { label: '⧉', variant: 'secondary' } })
    expect(await pane.find({ type: 'Button', key: `copy:${SELF}:q0` })).toBeUndefined()
    expect(await pane.find({ type: 'Button', key: `copy:${SELF}:pr:https://github.com/o/project/pull/42` })).toBeUndefined()
    await pane.press({ key: `copy:${SELF}:u1` })
    await w.clock.settle()
    expect(w.clipboard.copied).toEqual(['uv sync'])
    expect(w.toasts).toEqual(['Copied'])
    await pane.unmount()
  })

  test('⧉ copies the whole text when there is no code span, and says why a copy failed', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] })])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: `copy:${SELF}:q1` })
    await w.clock.settle()
    expect(w.clipboard.copied).toEqual(['What is the budget?'])

    w.clipboard.works = false
    await pane.press({ key: `copy:${SELF}:q1` })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: /Failed: the clipboard did not take the text \(no-clipboard\)/ })).toBeDefined()
    await pane.unmount()
  })
})

describe('views', () => {
  const seed = [
    fileOf('session-b', { title: 'Publish the blog', cwd: '/work/blog', branch: 'post', updatedAt: NOW - 1000, items: [
      { id: 'rel', kind: 'next_step', text: 'Publish it', owner: 'you' },
      { id: 'chk', kind: 'unverified', text: 'Phone layout not checked' },
    ] }),
    fileOf(SELF, { title: 'Tidy the logs', updatedAt: NOW, items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] }),
  ]

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`session and kind views draw on ${surface}`, async ($, on) => {
      const w = world(on, () => ({ exitCode: 0, stdout: prJson('OPEN'), stderr: '' }), seed)
      await start($, w)

      const pane = await mountPane($, surface, true)
      await pane.press({ key: 'view-session' })
      await w.clock.settle()
      const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
      // Sessions newest first, each a bordered box with a bold header and count.
      expect(texts).toContain('Tidy the logs (2) (this session)')
      expect(texts.indexOf('Tidy the logs (2) (this session)')).toBeLessThan(texts.indexOf('Publish the blog (2)'))
      expect(texts).toContain('blog / post')
      expect(texts).toContain('Open PRs (1)')
      expect(texts).toContain('Add the logs')
      expect(await pane.find({ type: 'Link', text: '#42' })).toBeDefined()
      const header = await pane.find({ type: 'Text', text: 'Questions for you (1)' })
      expect(header?.props.bold).toBe(true)
      expect(header?.props.dimColor).toBeUndefined()
      const boxes = await pane.findAll({ type: 'Box' })
      expect(boxes.filter(b => b.props.borderStyle === 'round').length).toBe(2)

      await pane.press({ key: 'view-kind' })
      await w.clock.settle()
      const kinds = (await pane.findAll({ type: 'Text' })).map(t => t.text)
      const order = ['Questions for you (1)', 'Open PRs (1)', 'Next steps (1)', 'Unverified / limits (1)']
      const at = order.map(h => kinds.indexOf(h))
      expect(at.every(i => i >= 0)).toBe(true)
      expect(at).toEqual([...at].sort((a, b) => a - b))
      expect(kinds).toContain('Publish it (owner: you) — Publish the blog')
      // Item text at normal contrast; only the owner and the session name are dim.
      expect(await pane.find({ type: 'Text', text: 'Publish it (owner: you) — Publish the blog' })).toMatchObject({
        props: { wrap: 'wrap' },
        children: ['Publish it', { props: { dimColor: true }, children: [' (owner: you)'] }, { props: { dimColor: true }, children: [' — Publish the blog'] }],
      })
      await pane.unmount()

      const band = await mountBand($, surface)
      // The band counts this session only by default.
      expect(await band.find({ type: 'Text', text: 'Questions 1 · Your actions 0 · PRs 1 · Next 0 · Unverified 0' })).toBeDefined()
      expect(await band.find({ type: 'Button', key: 'open' })).toMatchObject({ props: { label: 'Open' } })
      await band.unmount()
    })
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the toolbar keeps tabs left and actions right, and shows focus, on ${surface}`, async ($, on) => {
      const w = world(on, NO_PR, seed)
      await start($, w)

      const blurred = await mountPane($, surface, false)
      const hint = surface === 'desktop' ? 'Click to focus' : 'Click or ctrl+x tab to focus'
      expect(await blurred.find({ type: 'Text', text: hint })).toMatchObject({ props: { dimColor: true } })
      expect(await blurred.find({ type: 'Text', text: '● Focused' })).toBeUndefined()
      // Unfocused, the body is dim too.
      expect(await blurred.find({ type: 'Text', text: /budget/ })).toMatchObject({ props: { dimColor: true } })
      expect(await blurred.find({ type: 'Text', text: 'Questions for you (1)' })).toMatchObject({ props: { dimColor: true } })
      const bar = (await blurred.findAll({ type: 'Box' })).find(b => b.props.justifyContent === 'space-between')
      expect(bar?.children).toMatchObject([
        { children: [{ props: { label: 'This session' } }, {}, { props: { label: 'By session' } }, {}, { props: { label: 'By kind' } }] },
        { props: { flexShrink: 0 }, children: [{}, { props: { label: 'Refresh', plain: true, dimColor: true } }, {}, { props: { label: '☐ Show done (0)', plain: true, dimColor: true } }] },
      ])
      await blurred.unmount()

      const focused = await mountPane($, surface, true)
      const marker = await focused.find({ type: 'Text', text: '● Focused' })
      expect(marker).toMatchObject({ props: { color: 'subtle' } })
      expect(marker?.props.bold).toBeUndefined()
      expect(marker?.props.backgroundColor).toBeUndefined()
      expect(await focused.find({ type: 'Text', text: hint })).toBeUndefined()
      expect((await focused.find({ type: 'Text', text: /budget/ }))?.props.dimColor).toBeUndefined()
      expect((await focused.find({ type: 'Text', text: 'Questions for you (1)' }))?.props.dimColor).toBeUndefined()
      await focused.unmount()
    })
  }

  test('a long item is one row with its full text, never cut', async ($, on) => {
    const long = `Check that ${'every wrapped line hangs under the text '.repeat(8)}end`
    const w = world(on, NO_PR, [fileOf(SELF, { title: 'A long title '.repeat(9).trim(), items: [{ id: 'long', kind: 'unverified', text: long }] })])
    await start($, w)
    const pane = await mountPane($, 'terminal')
    const row = await pane.find({ type: 'Box', key: `${SELF}:long` })
    // Buttons top-aligned in a fixed column, the text in a shrinking column, a gap below.
    expect(row?.props).toMatchObject({ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 1 })
    expect(row?.children).toMatchObject([
      { props: { flexShrink: 0 }, children: [
        { type: 'Button', props: { label: '✓' } }, { type: 'Text', children: [' '] },
        { type: 'Button', props: { label: '⧉' } }, { type: 'Text', children: [' '] },
        { type: 'Button', props: { label: '↩' } }, { type: 'Text', children: [' '] },
      ] },
      { props: { flexShrink: 1 } },
    ])
    expect(row?.text).not.toContain('•')
    expect(row?.text).toContain(long)
    expect(await pane.find({ type: 'Text', text: long })).toMatchObject({ props: { wrap: 'wrap' } })
    expect(await pane.find({ type: 'Text', text: /A long title A long title.* \(1\)/ })).toBeDefined()
    const all = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(all).not.toContain('…')
    await pane.unmount()
  })

  test('the default view is this session only, and every session starts on it', async ($, on) => {
    const w = world(on, NO_PR, seed)
    await start($, w)
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Button', key: 'view-self' })).toMatchObject({ props: { label: 'This session', variant: 'primary' } })
    expect(await pane.find({ type: 'Text', text: 'Tidy the logs (1) (this session)' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Publish the blog/ })).toBeUndefined()
    expect((await pane.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'round').length).toBe(1)
    await pane.press({ key: 'view-kind' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: /Publish it/ })).toBeDefined()
    await pane.unmount()

    await start($, w)
    const again = await mountPane($)
    expect(await again.find({ type: 'Button', key: 'view-self' })).toMatchObject({ props: { variant: 'primary' } })
    expect(await again.find({ type: 'Button', key: 'view-kind' })).toMatchObject({ props: { variant: 'secondary' } })
    await again.unmount()
  })

  test('with nothing in this session, the default view points at the other sessions', async ($, on) => {
    const w = world(on, NO_PR, [seed[0]!, fileOf(SELF, { dismissed: ['q1'], done: [{ id: 'q1', doneAt: NOW, item: { id: 'q1', kind: 'question', text: 'Old' } }] })])
    await start($, w)
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: 'Nothing pending in this session' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Other sessions: 2' })).toMatchObject({ props: { dimColor: true } })
    // Show done counts this session's done entries only.
    expect(await pane.find({ type: 'Button', key: 'toggle-done' })).toMatchObject({ props: { label: '☐ Show done (1)' } })
    await pane.unmount()
  })

  test('the band steps aside while a survey shows', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [{ id: 'q1', kind: 'question', text: 'What is the budget?' }] })])
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'survey' }))
    await start($, w)
    const band = await mountBand($, 'desktop', true)
    expect(await band.find({ text: 'survey' })).toBeDefined()
    expect(await band.find({ type: 'Button', key: 'open' })).toBeUndefined()
    await band.unmount()
  })
})

describe('band', () => {
  const seed = () => [
    fileOf('session-b', { title: 'Publish the blog', hostSessionId: 'local_b', updatedAt: NOW - 1000, items: [
      { id: 'q2', kind: 'question', text: 'Which venue?' },
      { id: 'n2', kind: 'next_step', text: 'Release it' },
    ] }),
    fileOf(SELF, { title: 'Tidy', items: [{ id: 'u1', kind: 'user_action', text: 'Send the invoice' }] }),
  ]

  test('is one summary line: all five counts in a fixed order, Open and a dismiss control, no items', async ($, on) => {
    const w = world(on, NO_PR, seed())
    await start($, w)
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await mountBand($, surface)
      expect(await band.find({ type: 'Text', text: 'Questions 0 · Your actions 1 · PRs 0 · Next 0 · Unverified 0' })).toMatchObject({ props: { dimColor: true } })
      expect((await band.find({ type: 'Button', key: 'open' }))?.props).toEqual(expect.objectContaining({ label: 'Open' }))
      expect((await band.find({ type: 'Button', key: 'open' }))?.props.variant).toBeUndefined()
      expect(await band.find({ type: 'Button', key: 'close' }))
        .toMatchObject({ props: { label: surface === 'desktop' ? 'Close' : '×', role: 'dismiss' } })
      expect(await band.find({ type: 'Text', text: /Which venue\?|Send the invoice/ })).toBeUndefined()
      expect(await band.find({ type: 'Button', key: `reply:${SELF}:u1` })).toBeUndefined()
      await band.unmount()
    }
  })

  test('counts this session by default; the scope button switches to all sessions', async ($, on) => {
    const w = world(on, NO_PR, seed())
    await start($, w)
    const band = await mountBand($)
    expect(await band.find({ type: 'Button', key: 'scope' })).toMatchObject({ props: { label: 'All sessions' } })
    await band.press({ key: 'scope' })
    await w.clock.settle()
    expect(await band.find({ type: 'Text', text: 'Questions 1 · Your actions 1 · PRs 0 · Next 1 · Unverified 0' })).toBeDefined()
    expect(await band.find({ type: 'Button', key: 'scope' })).toMatchObject({ props: { label: 'This session' } })
    await band.unmount()

    // A new session starts on its own counts again.
    await start($, w)
    const again = await mountBand($)
    expect(await again.find({ type: 'Button', key: 'scope' })).toMatchObject({ props: { label: 'All sessions' } })
    await again.unmount()
  })

  test('with nothing in this session it still shows, pointing at the others', async ($, on) => {
    const w = world(on, NO_PR, [seed()[0]!])
    await start($, w)
    const band = await mountBand($)
    expect(await band.find({ type: 'Text', text: 'This session: nothing pending · Others 2' })).toMatchObject({ props: { dimColor: true } })
    expect(await band.find({ type: 'Button', key: 'scope' })).toBeDefined()
    await band.unmount()
  })

  test('is not drawn while every count is 0', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }))
    const w = world(on, NO_PR, [fileOf(SELF, { items: [] })])
    await start($, w)
    const band = await mountBand($)
    expect(await band.find({ text: 'prompt' })).toBeDefined()
    expect(await band.find({ type: 'Button', key: 'open' })).toBeUndefined()
    await band.unmount()
  })

  test('× hides the band until a new question or action appears', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }))
    const w = world(on, NO_PR, seed())
    await start($, w)
    const band = await mountBand($)
    await band.press({ key: 'close' })
    await w.clock.settle()
    await band.unmount()
    const closed = await mountBand($)
    expect(await closed.find({ type: 'Button', key: 'close' })).toBeUndefined()
    await closed.unmount()

    // Same ids again, plus only a new next step: stays closed.
    await $.tool.call({ tool: TOOL, title: 'Tidy', items: [
      { id: 'u1', kind: 'user_action', text: 'Send the invoice' },
      { id: 'n9', kind: 'next_step', text: 'Later' },
    ] })
    const still = await mountBand($)
    expect(await still.find({ type: 'Button', key: 'close' })).toBeUndefined()
    await still.unmount()

    // A new question: shown again.
    await $.tool.call({ tool: TOOL, title: 'Tidy', items: [
      { id: 'u1', kind: 'user_action', text: 'Send the invoice' },
      { id: 'q9', kind: 'question', text: 'Which font?' },
    ] })
    const back = await mountBand($)
    expect(await back.find({ type: 'Button', key: 'close' })).toBeDefined()
    await back.unmount()
  })

  test('× is remembered, and /follow-ups shows the band again', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }))
    const w = world(on, NO_PR, seed())
    await start($, w)
    const band = await mountBand($)
    await band.press({ key: 'close' })
    await w.clock.settle()
    await band.unmount()
    await start($, w)
    const closed = await mountBand($)
    expect(await closed.find({ type: 'Button', key: 'close' })).toBeUndefined()
    await closed.unmount()

    await $.command.run({ command: 'follow-ups', args: '' } as Parameters<typeof $.command.run>[0])
    await w.clock.settle()
    const back = await mountBand($)
    expect(await back.find({ type: 'Button', key: 'close' })).toBeDefined()
    await back.unmount()
  })
})
