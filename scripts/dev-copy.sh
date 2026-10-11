#!/usr/bin/env bash
# Refreshes the development copy of the follow-ups plugin for one session:
# copies the current working tree's plugin into
# ${FOLLOW_UPS_DEV_MODS:-~/.claude/dev-mods}/<session-id>/follow-ups-dev and renames it to
# follow-ups-dev, so it runs next to the installed version. The session file location is kept,
# so both read and write the same files. See README.md, "Trying a development copy".
#
# Usage: scripts/dev-copy.sh [session-id]   (defaults to $CLAUDE_CODE_SESSION_ID)
set -euo pipefail

die() {
  echo "dev-copy: $*" >&2
  exit 1
}

session_id="${1:-${CLAUDE_CODE_SESSION_ID:-}}"
[[ -n "$session_id" ]] || die "no session id: pass one as the argument or set CLAUDE_CODE_SESSION_ID"
[[ "$session_id" =~ ^[A-Za-z0-9_-]+$ ]] || die "invalid session id '$session_id' (allowed: A-Z a-z 0-9 _ -)"

# The source is the repository of the current directory, so any worktree or branch can be copied.
src="$(git rev-parse --show-toplevel)" || die "run this inside a checkout of claude-follow-ups"
for path in .claude-plugin/plugin.json hooks types; do
  [[ -e "$src/$path" ]] || die "$src/$path not found; is this a checkout of claude-follow-ups?"
done

target="${FOLLOW_UPS_DEV_MODS:-$HOME/.claude/dev-mods}/$session_id/follow-ups-dev"

# Replace the copied parts fully, so files deleted in the source disappear from the copy. The
# engine-generated .claude-plugin/types/ in the target is kept.
mkdir -p "$target/.claude-plugin"
rm -rf "$target/hooks" "$target/types"
cp "$src/.claude-plugin/plugin.json" "$target/.claude-plugin/plugin.json"
cp -R "$src/hooks" "$target/hooks"
cp -R "$src/types" "$target/types"

# Exact, anchored replacements; a blanket rename would also move the session file location.
# Each pattern must match: a miss means the source changed and this script needs updating.
replace() {
  local file="$1" expected="$2" from="$3" to="$4" count
  count="$(FROM="$from" perl -ne '$n += () = /\Q$ENV{FROM}\E/g; END { print $n + 0 }' "$file")"
  [[ "$count" == "$expected" || ( "$expected" == "+" && "$count" -gt 0 ) ]] \
    || die "expected ${expected/+/at least one} of [$from] in $file, found $count"
  FROM="$from" TO="$to" perl -pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/g' "$file"
}

replace "$target/.claude-plugin/plugin.json" 1 '"name": "follow-ups",' '"name": "follow-ups-dev",'

replace "$target/hooks/common.ts" 1 "export const PLUGIN = 'follow-ups'" "export const PLUGIN = 'follow-ups-dev'"
replace "$target/hooks/common.ts" 1 "export const PANE = 'follow-ups'" "export const PANE = 'follow-ups-dev'"
replace "$target/hooks/common.ts" 1 "export const PANE_TITLE = 'Follow-ups'" "export const PANE_TITLE = 'Follow-ups (dev)'"

reg="$target/hooks/register.tsx"
replace "$reg" + "atom({ plugin: 'follow-ups', key: " "atom({ plugin: 'follow-ups-dev', key: "
replace "$reg" 1 "\$.command.register({ name: 'follow-ups', description: 'Open the Follow-ups pane' })" \
  "\$.command.register({ name: 'follow-ups-dev', description: 'Open the Follow-ups (dev) pane' })"
replace "$reg" 1 "on('command.run', { command: 'follow-ups' }" "on('command.run', { command: 'follow-ups-dev' }"
replace "$reg" 1 "on('tool.call', { tool: 'mcp__follow-ups__pending_items_set' }" \
  "on('tool.call', { tool: 'mcp__follow-ups-dev__pending_items_set' }"
replace "$reg" 1 "{ component: 'Pane', requestId: 'follow-ups' }" "{ component: 'Pane', requestId: 'follow-ups-dev' }"

replace "$target/types/index.d.ts" 1 "    'follow-ups': {" "    'follow-ups-dev': {"

# Verify: nothing still names the installed plugin, and the session file location is unchanged.
leftover="$(grep -rnF -e "'follow-ups'" -e 'mcp__follow-ups__' -e '"name": "follow-ups"' \
  "$target/.claude-plugin/plugin.json" "$target/hooks" "$target/types" || true)"
[[ -z "$leftover" ]] || die "names of the installed plugin remain in the copy:"$'\n'"$leftover"
# shellcheck disable=SC2016 # a literal TypeScript template expression
grep -qF '${home}/.claude/follow-ups/sessions' "$target/hooks/store.ts" \
  || die "the session file location in hooks/store.ts changed; the copy would not share session files"

if command -v claude >/dev/null 2>&1; then
  claude plugin validate "$target"
else
  echo "dev-copy: claude not on PATH; skipped 'claude plugin validate'" >&2
fi

echo "$target"
