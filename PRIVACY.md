# Privacy

follow-ups is a Claude Code plugin that runs on your machine. Its author operates no service for
it and receives no data from it.

## What it stores

One JSON file per session, `~/.claude/follow-ups/sessions/<sessionId>.json`, on your machine
only. It holds:

- the items Claude reported for the session (questions, your own actions, unverified points and
  next steps), their text as Claude wrote it, which may include anything from the conversation,
  such as names;
- the session's title, state, activity line, working directory (which may contain your OS user
  name), Git branch and Claude Desktop session id;
- the URL, number, title and draft status of the session's open pull requests, and the first
  error line of a failed lookup.

Items you mark done are kept for 7 days, then removed. A session's file is deleted when the
Claude Desktop app archives that session; otherwise it stays until you delete it. Deleting the
`~/.claude/follow-ups/` folder removes everything the plugin stored.

## What it sends

Only to GitHub, through the `gh` CLI you have signed in to, to look up pull requests: the URL of
a pull request, or the working directory's repository and branch. It sends no item text, prompt
or other conversation content anywhere itself. What it adds to the prompt reaches the model with
the rest of the conversation, under the terms of your Claude account.

GitHub's handling of those requests is governed by the
[GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Contact

Open an issue at <https://github.com/hota911/follow-ups/issues>.
