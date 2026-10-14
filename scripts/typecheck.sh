#!/usr/bin/env bash
# Type-checks the development copy of the follow-ups plugin with tsc. The `claude-code` types are
# not published in any package: Claude Code writes them, with a tsconfig.json, into
# .claude-plugin/types/ of a mod it has loaded. So run scripts/dev-copy.sh first and let the
# session load the copy (hot reloading on), then run this. TypeScript comes from npx, not a global
# install. Checks the copy's hooks/ and types/ (the copy has no tests/).
#
# Usage: scripts/typecheck.sh [session-id]   (defaults to $CLAUDE_CODE_SESSION_ID)
set -euo pipefail

TYPESCRIPT_VERSION=5.6.3

die() {
  echo "typecheck: $*" >&2
  exit 1
}

session_id="${1:-${CLAUDE_CODE_SESSION_ID:-}}"
[[ -n "$session_id" ]] || die "no session id: pass one as the argument or set CLAUDE_CODE_SESSION_ID"
[[ "$session_id" =~ ^[A-Za-z0-9_-]+$ ]] || die "invalid session id '$session_id' (allowed: A-Z a-z 0-9 _ -)"

copy="${FOLLOW_UPS_DEV_MODS:-$HOME/.claude/dev-mods}/$session_id/follow-ups-dev"
tsconfig="$copy/.claude-plugin/types/tsconfig.json"
[[ -f "$tsconfig" ]] || die "$tsconfig not found: run scripts/dev-copy.sh and let the session load the copy first"

echo "typecheck: $(head -1 "$copy/.claude-plugin/types/claude-code/index.d.ts" | sed 's#^// ##; s#^Written#types written#')"
npx -y -p "typescript@$TYPESCRIPT_VERSION" tsc -p "$tsconfig"
echo "typecheck: no type errors"
