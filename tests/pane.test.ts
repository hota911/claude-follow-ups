// The pane: when it opens on its own, and what its views draw.
import { describe, expect, test } from 'claude-code/testing'

import { SELF, TOOL, NOW, NO_PR, prJson, fileOf, world, start, mountPane, mountBand } from './world'

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
