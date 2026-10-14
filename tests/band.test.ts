// The band above the prompt: its counts, its scope, and closing it.
import { describe, expect, test } from 'claude-code/testing'

import { SELF, TOOL, NOW, NO_PR, fileOf, world, start, mountBand } from './world'

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
