// The sessions' PRs: which urls a `gh pr create` printed, the gh command that looks one up, how
// its outcome reads, how a stored PR parses, and how lookups change a session file. Pure:
// register.tsx runs gh and writes the file.
import type { PendingItemsPr, PendingItemsSessionFile } from '../types'
import { errorLine, firstLine, isObject, stripControls } from './common'

// `gh pr create` as a command of the shell line, not inside a longer word.
const GH_PR_CREATE = /(^|[\s;&|(])gh\s+pr\s+create\b/
const PR_URL = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g
// A whole string that is one such url: the only PR url stored, or passed to gh.
const PR_URL_EXACT = new RegExp(`^${PR_URL.source}$`)

/** The PR urls a Bash command printed, when the command runs `gh pr create`; none otherwise. */
export function createdPrUrls(command: string, stdout: string): string[] {
  if (!GH_PR_CREATE.test(command)) return []
  return [...new Set(stdout.match(PR_URL) ?? [])]
}

/** A stored PR as this mod writes it, its url a github.com PR's; undefined when it is not one. */
export function parsePr(value: unknown): PendingItemsPr | undefined {
  if (!isObject(value)) return undefined
  const { number, title, url, isDraft } = value
  if (!Number.isInteger(number) || typeof title !== 'string' || typeof url !== 'string' || typeof isDraft !== 'boolean') return undefined
  if (!PR_URL_EXACT.test(url)) return undefined
  return { number: number as number, title: stripControls(title), url, isDraft }
}

/** The PRs in order with later copies of a url left out. */
export function uniqueByUrl(prs: PendingItemsPr[]): PendingItemsPr[] {
  return prs.filter((pr, index) => prs.findIndex(other => other.url === pr.url) === index)
}

export function prDismissId(pr: PendingItemsPr): string {
  return `pr:${pr.url}`
}

// Shape of `gh pr view --json number,title,url,state,isDraft`.
type GhPrView = { number: number; title: string; url: string; state: string; isDraft: boolean }

/**
 * The PR when it is open; undefined when merged or closed. Throws on a PR this mod would not store
 * (a url outside github.com, say), so the lookup shows as failed instead of writing a file no
 * reader takes.
 */
export function parsePrView(stdout: string): PendingItemsPr | undefined {
  const view = JSON.parse(stdout) as GhPrView
  if (view.state !== 'OPEN') return undefined
  const pr = parsePr({ number: view.number, title: view.title, url: view.url, isDraft: view.isDraft })
  if (pr === undefined) throw new Error('gh returned a PR that is not a github.com pull request')
  return pr
}

/** gh's answer for a branch or directory that can have no PR: not an error to show. */
export function meansNoPr(stderr: string): boolean {
  return /no pull requests found|not a git repository/i.test(stderr)
}

const PR_FIELDS = 'number,title,url,state,isDraft'

/** One lookup: the open PR it found (undefined when there is none), or why it failed. */
export type PrLookup = { pr: PendingItemsPr | undefined; prError?: never } | { pr?: never; prError: string }

/**
 * `gh pr view` for the cwd's branch, or for a known PR by its url, after `--` so it is never read
 * as a flag (stored urls are validated too; see parseSessionFile).
 */
export function prViewArgv(url?: string): string[] {
  return url === undefined
    ? ['gh', 'pr', 'view', '--json', PR_FIELDS]
    : ['gh', 'pr', 'view', '--json', PR_FIELDS, '--', url]
}

/** What one `gh pr view` run found: a PR, no PR for the branch (not an error), or its first stderr line. */
export function lookupOf(ran: { exitCode: number; stdout: string; stderr: string }): PrLookup {
  if (ran.exitCode === 0) return { pr: parsePrView(ran.stdout) }
  if (meansNoPr(ran.stderr)) return { pr: undefined }
  return { prError: firstLine(ran.stderr) || `gh exited with ${ran.exitCode}` }
}

/** A `gh pr view` run that could not start. */
export function failedLookup(err: unknown): PrLookup {
  return { prError: errorLine(err) }
}

/**
 * One lookup to apply to a file. `recheckOf` is the url of a stored PR looked up again: it is
 * dropped once no longer open, and never added back when no longer stored. A lookup without it
 * (the cwd branch's, or a url `gh pr create` printed) adds the open PR it found.
 */
export type PrCheck = { found: PrLookup; recheckOf?: string }

/**
 * Applies one check's lookups: a failed lookup keeps the PRs as last seen and its error is
 * shown; a dismissed PR is not added. `prError` is the first failure of these lookups.
 */
export function withPrChecks(file: PendingItemsSessionFile, checks: PrCheck[]): PendingItemsSessionFile {
  let prs = file.prs
  for (const { found, recheckOf } of checks) {
    if (found.prError !== undefined) continue
    const pr = found.pr
    if (recheckOf !== undefined) {
      if (!prs.some(stored => stored.url === recheckOf)) continue
      prs = pr === undefined
        ? prs.filter(stored => stored.url !== recheckOf)
        : prs.map(stored => stored.url === recheckOf ? pr : stored)
    } else if (pr !== undefined && !file.dismissed.includes(prDismissId(pr))) {
      prs = uniqueByUrl([...prs.map(stored => stored.url === pr.url ? pr : stored), pr])
    }
  }
  const prError = checks.map(check => check.found.prError).find(error => error !== undefined)
  const { prError: _prError, ...rest } = file
  return { ...rest, prs, ...(prError !== undefined ? { prError } : {}) }
}
