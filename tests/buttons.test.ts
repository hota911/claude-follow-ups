// A row's buttons other than ✓/↺: ↩ and a question's choices, ↗ and Resume, a sent ↩ quote, and ⧉.
import { describe, expect, test, type Engine } from 'claude-code/testing'

import { SELF, TOOL, NOW, NO_PR, prJson, fileOf, world, start, mountPane } from './world'

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
