# Agent instructions

The plugin is submitted to the Claude plugin directory. What it does must stay consistent with
what the repository discloses and what the submission answered. Read this before changing what
the plugin reads, writes, runs, sends or hooks.

## Keep the disclosures true

These state what the plugin does, and the directory and its users rely on them:

- `PRIVACY.md`: what is stored, where and for how long, and what is sent where.
- The "What it reads, writes, runs and sends" section of `README.md`, and the same section of
  `README.ja.md` ("読み書き、実行、送信するもの").
- The "How it works" table of both READMEs.

A change that alters any of these facts updates all of them in the same pull request: a new
program run, a new destination for data, a new field stored, a new file written, a changed
retention period, a new prompt submitted, a new hook on a tool, prompt or command event. If a
change cannot be described truthfully in them, do not make it without asking the maintainer.

## Stay within the submission's answers

The directory submission answered as follows. A change that would make an answer false needs the
maintainer's decision first, since the submission must then be updated too.

- Personal data: reads and stores, on the user's machine only
  (`~/.claude/follow-ups/sessions/`). Nothing is sent to the author or any service the author
  runs.
- Data sent to a service other than declared connectors: only GitHub, through the `gh` CLI,
  listed in the README. Adding any other destination changes this answer.
- Retention by the author's service: not retained (there is no such service).
- Intended for users under 18: no.

## Directory policy

The [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)
applies to every change. The points this plugin is closest to:

- Collect only the data its function needs; no extra conversation data, not even for logging (1D).
- Do not read Claude's memory, chat history, transcripts or uploaded files (1F). The Desktop
  session record is read only for `isArchived`.
- The tool description and the system prompt section stay fixed, human-readable text that matches
  what the plugin does; no hidden or encoded instructions, no instructions fetched from outside
  (2B, 2F, 2G).
- Do not make Claude call other tools or software the user did not ask for (2D, 2E).

## Directory checks

- Do not hook permission events (`tool.check`, `classic.PermissionRequest`): the directory blocks
  a hook it cannot confirm leaves the permission decision with the person, even one that returns
  `next(e)` unchanged. Needs permission is recorded from the `permission_prompt` notification
  (`classic.Notification`) instead.
- Keep `"types"` in `.claude-plugin/plugin.json`. The directory warns that it is an unknown field,
  but `claude plugin validate` fails without it (the `$.state` contract).
- Keep the `.claude-plugin/icon.png` and the Privacy link at the top of both READMEs.

Before opening a pull request, run `claude plugin validate .` and `claude plugin test .`.
