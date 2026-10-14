// The session files on disk: one that does not parse is never replaced, and another session's
// file is deleted once its Desktop session is archived.
import { describe, expect, test } from 'claude-code/testing'

import { DIR, SELF, TOOL, NO_PR, fileOf, prJson, world, start, mountPane } from './world'

describe('unreadable session files', () => {
  const item = { id: 'q', kind: 'question' as const, text: 'Which venue?' }

  test('this session\'s file that does not parse is never replaced: the tool is refused and says why', async ($, on) => {
    const w = world(on, NO_PR)
    w.putFile(SELF, '{ "sessionId": "session-a", "items": [')
    await start($, w)
    const ran = await $.tool.call({ tool: TOOL, title: 'Mine', items: [item] })
    expect(ran.deny).toBe(`${TOOL} did not store the list: session-a.json is not a valid follow-ups session file (not JSON); it was left unchanged. `
      + 'Tell the user; calling again fails until they fix or remove the file.')
    expect(w.raw(SELF)).toBe('{ "sessionId": "session-a", "items": [')
  })

  test('a PR found for this session does not replace its file that does not parse; the pane names the file', async ($, on) => {
    const stored = JSON.stringify({ ...fileOf(SELF, { items: [item] }), dismissed: 'not a list' })
    const w = world(on, () => ({ exitCode: 0, stdout: prJson('OPEN'), stderr: '' }))
    w.putFile(SELF, stored)
    await start($, w)
    expect(w.raw(SELF)).toBe(stored)
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: 'Failed: session-a.json is not a valid follow-ups session file (dismissed must be strings); it was left unchanged' })).toBeDefined()
    await pane.unmount()
  })

  test('another session\'s file that fails a check is skipped, named in the pane and left as it is', async ($, on) => {
    const bad: Record<string, string> = {
      'session-b': JSON.stringify(fileOf('session-c', { items: [item] })),
      'session-d': JSON.stringify(fileOf('session-d', { hostSessionId: '../../x', items: [item] })),
      'session-e': JSON.stringify(fileOf('session-e', { prs: [{ number: 1, title: 'x', url: '--repo=evil/x', isDraft: false }] })),
      'session-f': JSON.stringify({ ...fileOf('session-f', { items: [item] }), cwd: 7 }),
      'session-g': JSON.stringify(fileOf('session-g', { items: [{ ...item, url: 'file:///etc/passwd' }] })),
      'session-h': JSON.stringify(fileOf('session-h', { items: Array.from({ length: 51 }, (_, index) => ({ ...item, id: `q${index}` })) })),
    }
    const gh: string[][] = []
    const w = world(on, argv => {
      gh.push([...argv])
      return NO_PR(argv)
    }, [fileOf('session-ok', { items: [{ ...item, text: 'Still shown' }] })])
    for (const [id, text] of Object.entries(bad)) w.putFile(id, text)
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'refresh' })
    await w.clock.settle()
    await pane.press({ key: 'view-session' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: 'Still shown' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Which venue/ })).toBeUndefined()
    const failure = (await pane.find({ type: 'Text', text: /^Failed:/ }))?.text ?? ''
    expect(failure).toContain('session-b.json is not a valid follow-ups session file (sessionId does not match the file name)')
    expect(failure).toContain('session-d.json is not a valid follow-ups session file (hostSessionId is not a Desktop session id)')
    expect(failure).toContain('session-e.json is not a valid follow-ups session file (a stored PR is not a github.com pull request)')
    expect(failure).toContain('session-f.json is not a valid follow-ups session file (title, cwd and branch must be strings)')
    expect(failure).toContain('session-g.json is not a valid follow-ups session file (items[0].url must be an http: or https: URL)')
    expect(failure).toContain('session-h.json is not a valid follow-ups session file (items must have at most 50 entries)')
    await pane.unmount()
    for (const [id, text] of Object.entries(bad)) expect(w.raw(id)).toBe(text)
    expect(gh.flat()).not.toContain('--repo=evil/x')
    expect(w.removed).toEqual([])
  })

  test('a skipped file stays named beside a press\'s failure, until a load finds it gone', async ($, on) => {
    const w = world(on, NO_PR, [fileOf(SELF, { items: [item] })])
    w.putFile('session-b', '{')
    await start($, w)
    const pane = await mountPane($)
    const skipped = 'Failed: session-b.json is not a valid follow-ups session file (not JSON); it was left unchanged'
    expect(await pane.find({ type: 'Text', text: skipped })).toBeDefined()

    // A failed press adds its own line; the skipped file stays named.
    w.clipboard.works = false
    await pane.press({ key: `copy:${SELF}:q` })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: 'Failed: the clipboard did not take the text (no-clipboard)' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: skipped })).toBeDefined()

    // A press that succeeds clears the earlier press's failure, not the skipped file.
    w.clipboard.works = true
    await pane.press({ key: `copy:${SELF}:q` })
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: /the clipboard did not take/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: skipped })).toBeDefined()

    // Once the file is gone, the next load (here the 30-second one) clears its line.
    w.removeFile('session-b')
    await w.clock.advance(30 * 1000)
    await w.clock.settle()
    expect(await pane.find({ type: 'Text', text: /^Failed:/ })).toBeUndefined()
    await pane.unmount()
  })

  test('text read from a file is drawn without control characters', async ($, on) => {
    const w = world(on, NO_PR)
    w.putFile(SELF, JSON.stringify(fileOf(SELF, { title: 'Ti\u001b[2Jtle', items: [{ ...item, text: 'Which\u001b]0;pwned\u0007 venue?' }] })))
    await start($, w)
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: /^Which venue\?$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Title/ })).toBeDefined()
    await pane.unmount()
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

  test('a file rewritten for another Desktop session between the archive check and the delete is kept', async ($, on) => {
    const w = world(on, NO_PR, [fileOf('session-b', { hostSessionId: 'local_b', items: [item] })])
    w.putRecord('local_b', archived)
    const rewritten = JSON.stringify(fileOf('session-b', { hostSessionId: 'local_b2', items: [item] }))
    w.afterRecordRead('local_b', () => w.putFile('session-b', rewritten))
    await start($, w)
    expect(w.removed).toEqual([])
    expect(w.raw('session-b')).toBe(rewritten)
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
