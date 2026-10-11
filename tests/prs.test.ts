// The sessions' PRs: the branch PR and the PRs a session creates.
import { describe, expect, test } from 'claude-code/testing'

import { SELF, CWD, NOW, type Gh, NO_PR, prJson, fileOf, world, start, mountPane, mountBand } from './world'

describe('session PR', () => {
  test('an open PR is stored and cleared once merged', async ($, on) => {
    const w = world(on, () => ({ exitCode: 0, stdout: prJson('OPEN'), stderr: '' }))
    await start($, w)
    expect(w.file(SELF)?.prs.map(p => p.number)).toEqual([42])

    w.setGh(() => ({ exitCode: 0, stdout: prJson('MERGED'), stderr: '' }))
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.settle()
    expect(w.file(SELF)?.prs).toEqual([])
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: 'Nothing pending' })).toBeDefined()
    await pane.unmount()
  })

  test('a gh failure shows its first stderr line in the session block', async ($, on) => {
    const w = world(on, () => ({ exitCode: 4, stdout: '', stderr: 'gh auth login required\nmore' }))
    await start($, w)
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: 'PR check failed: gh auth login required' })).toBeDefined()
    await pane.unmount()
  })

  test('a PR title and a gh error line are stored without control characters', async ($, on) => {
    const titled = JSON.stringify({ number: 42, title: 'Add\u001b[31m the\u0007 logs', url: 'https://github.com/o/project/pull/42', state: 'OPEN', isDraft: false })
    const w = world(on, () => ({ exitCode: 0, stdout: titled, stderr: '' }))
    await start($, w)
    expect(w.file(SELF)?.prs.map(p => p.title)).toEqual(['Add the logs'])

    w.setGh(() => ({ exitCode: 4, stdout: '', stderr: '\u001b]0;x\u0007gh auth\u001b[1m login\u0000 required\n' }))
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.settle()
    expect(w.file(SELF)?.prError).toBe('gh auth login required')
  })

  test('a PR outside github.com is a failed lookup, not a stored PR', async ($, on) => {
    const elsewhere = JSON.stringify({ number: 3, title: 'Elsewhere', url: 'https://git.example.com/o/p/pull/3', state: 'OPEN', isDraft: false })
    const w = world(on, () => ({ exitCode: 0, stdout: elsewhere, stderr: '' }))
    await start($, w)
    expect(w.file(SELF)?.prs).toEqual([])
    expect(w.file(SELF)?.prError).toBe('gh returned a PR that is not a github.com pull request')
  })

  test('a stored PR is looked up by its url after `--`', async ($, on) => {
    const url = 'https://github.com/o/project/pull/42'
    const calls: string[][] = []
    const w = world(on, argv => {
      calls.push([...argv])
      return argv.includes(url) ? { exitCode: 0, stdout: prJson('OPEN'), stderr: '' } : NO_PR(argv)
    }, [fileOf('session-b', { prs: [{ number: 42, title: 'Add the logs', url, isDraft: false }] })])
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'refresh' })
    await w.clock.settle()
    await pane.unmount()
    expect(calls).toContainEqual(['gh', 'pr', 'view', '--json', 'number,title,url,state,isDraft', '--', url])
  })

  test('no PR for the branch is not an error and writes nothing', async ($, on) => {
    const w = world(on, NO_PR)
    await start($, w)
    expect(w.file(SELF)).toBeUndefined()
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: 'Nothing pending' })).toBeDefined()
    await pane.unmount()
  })
})

describe('PRs the session creates', () => {
  const OTHER = 'https://github.com/o/other/pull/7'
  const otherJson = (state: string) => JSON.stringify({ number: 7, title: 'Fix the skill', url: OTHER, state, isDraft: true })
  // gh answering the cwd branch's lookup with `branch`, and a lookup by url with that PR's state.
  const ghWith = (branch: Gh, states: Record<string, string>): Gh => argv => {
    const url = argv.at(-1) ?? ''
    if (!url.startsWith('https://')) return branch(argv)
    if (url === OTHER) return { exitCode: 0, stdout: otherJson(states[OTHER] ?? 'OPEN'), stderr: '' }
    return { exitCode: 0, stdout: prJson(states[url] ?? 'OPEN'), stderr: '' }
  }
  const createdOther = () => `Creating pull request for fix into main in o/other\n\n${OTHER}\n`

  test('a Bash `gh pr create` records the PR it printed and opens the pane', async ($, on) => {
    const w = world(on, ghWith(NO_PR, {}))
    await start($, w)
    w.setBash(createdOther)
    const call = await $.tool.call({ tool: 'Bash', command: 'cd ../other && gh pr create --draft --fill' })
    expect(call).toMatchObject({ text: createdOther() })
    await w.clock.settle()
    expect(w.file(SELF)?.prs.map(p => p.url)).toEqual([OTHER])
    // Older pre-release readers know only `pr`.
    expect(w.file(SELF)?.pr?.url).toBe(OTHER)
    expect(w.panesOpened).toEqual(['follow-ups'])
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: 'Fix the skill' })).toBeDefined()
    expect(await pane.find({ type: 'Link', text: '#7' })).toBeDefined()
    await pane.unmount()
  })

  test("the branch's PR and a created one both show, count, clear and are done one at a time", async ($, on) => {
    const states: Record<string, string> = {}
    const w = world(on, ghWith(() => ({ exitCode: 0, stdout: prJson('OPEN'), stderr: '' }), states))
    await start($, w)
    w.setBash(createdOther)
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
    await w.clock.settle()
    expect(w.file(SELF)?.prs.map(p => p.number)).toEqual([42, 7])
    const band = await mountBand($)
    expect(await band.find({ type: 'Text', text: 'Questions 0 · Your actions 0 · PRs 2 · Next 0 · Unverified 0' })).toBeDefined()
    await band.unmount()
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Link', text: '#42' })).toBeDefined()
    expect(await pane.find({ type: 'Link', text: '#7' })).toBeDefined()
    await pane.unmount()

    states[OTHER] = 'MERGED'
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.settle()
    expect(w.file(SELF)?.prs.map(p => p.number)).toEqual([42])

    states[OTHER] = 'OPEN'
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
    await w.clock.settle()
    const again = await mountPane($)
    await again.press({ key: `act:${SELF}:pr:https://github.com/o/project/pull/42` })
    await w.clock.settle()
    expect(w.file(SELF)?.prs.map(p => p.number)).toEqual([7])
    expect(w.file(SELF)?.pr?.number).toBe(7)
    await again.unmount()
  })

  test('a command other than `gh pr create` records nothing, even when it prints a PR url', async ($, on) => {
    const w = world(on, ghWith(NO_PR, {}))
    await start($, w)
    w.setBash(() => `${OTHER}\n`)
    await $.tool.call({ tool: 'Bash', command: `echo ${OTHER}` })
    await $.tool.call({ tool: 'Bash', command: `gh pr view ${OTHER}` })
    await w.clock.settle()
    expect(w.file(SELF)).toBeUndefined()
  })

  test('a file an older version wrote, with only `pr`, still reads', async ($, on) => {
    const w = world(on, NO_PR)
    const pr = { number: 42, title: 'Add the logs', url: 'https://github.com/o/project/pull/42', isDraft: false }
    w.putFile('session-b', JSON.stringify({
      sessionId: 'session-b', title: 'Old', cwd: CWD, branch: 'b', items: [], dismissed: [], updatedAt: NOW, pr,
    }))
    // An older writer's Done leaves the PR in `prs` and its id in `dismissed`: hidden.
    w.putFile('session-c', JSON.stringify({
      ...fileOf('session-c', { title: 'Dismissed', items: [{ id: 'q1', kind: 'question', text: 'Kept' }], prs: [{ ...pr, number: 9, url: 'https://github.com/o/project/pull/9' }] }),
      dismissed: ['pr:https://github.com/o/project/pull/9'],
    }))
    await start($, w)
    const pane = await mountPane($)
    await pane.press({ key: 'view-session' })
    await w.clock.settle()
    expect(await pane.find({ type: 'Link', text: '#42' })).toBeDefined()
    expect(await pane.find({ type: 'Link', text: '#9' })).toBeUndefined()
    await pane.unmount()
  })
})
