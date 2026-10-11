// The sessions' PRs: the gh command that looks one up, how its outcome reads, and how lookups
// change a session file. Pure: register.tsx runs gh and writes the file.
import type { PendingItemsPr, PendingItemsSessionFile } from '../types'
import { errorLine } from './common'
import { firstLine, meansNoPr, parsePrView, prDismissId, uniqueByUrl } from './parse'

const PR_FIELDS = 'number,title,url,state,isDraft'

export type PrLookup = { pr: PendingItemsPr | undefined; prError: string | undefined }

/** `gh pr view` for the cwd's branch, or for a known PR by its url. */
export function prViewArgv(url?: string): string[] {
  return url === undefined
    ? ['gh', 'pr', 'view', '--json', PR_FIELDS]
    : ['gh', 'pr', 'view', url, '--json', PR_FIELDS]
}

/** What one `gh pr view` run found: a PR, no PR for the branch (not an error), or its first stderr line. */
export function lookupOf(ran: { exitCode: number; stdout: string; stderr: string }): PrLookup {
  if (ran.exitCode === 0) return { pr: parsePrView(ran.stdout), prError: undefined }
  if (meansNoPr(ran.stderr)) return { pr: undefined, prError: undefined }
  return { pr: undefined, prError: firstLine(ran.stderr) || `gh exited with ${ran.exitCode}` }
}

/** A `gh pr view` run that could not start. */
export function failedLookup(err: unknown): PrLookup {
  return { pr: undefined, prError: errorLine(err) }
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
