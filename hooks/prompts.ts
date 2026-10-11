/**
 * Every text the model reads from this mod, in one place. Labels shown to the person stay in
 * register.tsx.
 *
 * Where each text reaches the model:
 * - composeText: the system prompt section, sent every turn. It must stay fixed text (no items,
 *   times or other changing data), so the prompt and the conversation cache do not change when
 *   items change.
 * - TOOL_DESCRIPTION and INPUT_DESCRIPTIONS: the tool's description and its input schema,
 *   registered at session start.
 * - storedResult, hiddenResult, subagentDeny, inputDeny, storeFailedDeny, invalidFileDeny and INPUT_ERRORS: the
 *   tool result, or the deny reason, of one tool call.
 * - COMMAND_RESULT: the answer to /follow-ups, read by the model when it runs the command.
 * - doneNotice: context beside the prompt at prompt submit (never shown in the transcript).
 *
 * Texts that name the tool take its full name as an argument, so this file holds no plugin id or
 * tool name and the dev copy, which renames the plugin, uses it unchanged.
 */

// Shared by the tool description and the system prompt section.
const KINDS_GUIDE = [
  'Kinds: question = something the user must answer and can answer now; user_action = something the user can do right now;',
  'unverified = a point not verified or a limitation of the work; next_step = a remaining step after this turn',
  '(e.g. merge a PR, release), with owner naming who does it (you, Claude, a person or team).',
  'Something the user will do or decide later, once a prerequisite is done (e.g. merge the PR after the fix lands),',
  'is a next_step with the user as owner, not a user_action or question.',
  'Whenever your reply asks the user to do or answer something, put the same request in the list in that same turn:',
  'a user_action or question if it can be done now, otherwise a next_step with the user as owner. Remove it once it is resolved.',
].join(' ')

export const TOOL_DESCRIPTION = [
  'Replace the list of things this session is waiting on the user for, shown in the user\'s Follow-ups pane across sessions.',
  'Always send the full current list; it replaces the previous one. Send an empty list when nothing is left.',
  KINDS_GUIDE,
  'Write title and text in the language the user is using in this session, short and self-contained (readable without the conversation). Keep ids stable across calls.',
  'Ids the user marked done stay hidden even if sent again.',
  'Give a question options only when a short choice such as Yes / No fully answers it; the user can then answer with one click.',
].join(' ')

/** The descriptions of the tool's input fields, by field name. */
export const INPUT_DESCRIPTIONS = {
  title: 'Short name of what this session is doing, in the user\'s language',
  activity: 'One short line on what this session is doing now, shown next to Running',
  id: 'Stable short slug chosen by you',
  text: 'Short, self-contained text in the user\'s language',
  owner: 'Who does it, mainly for next_step',
  url: 'An https: link for the item, if any',
  options: 'Only for a question that a short choice fully answers (e.g. Yes / No): 2-4 short answers, '
    + 'each shown as a button that sends it as the user\'s reply. Omit for open questions',
} as const

/**
 * The system prompt section; `tool` is the tool's full name. Fixed text only: the model sees
 * its list in its own tool calls.
 */
export function composeText(tool: string): string {
  return [
    '# Follow-ups for the user',
    `In the Follow-ups pane, the user tracks, across parallel sessions, what each session is waiting on them for, through the ${tool} tool.`,
    'Before ending a turn, call it with the full current list whenever a question, user_action, unverified point or next_step exists or changed.',
    KINDS_GUIDE,
    'Remove items that are resolved and keep ids stable.',
    'Write the title and item text in the language the user is using in this session, short and self-contained (readable without this conversation).',
    'Ids the user marked done stay hidden even if sent again.',
    'Give a question options only when a short choice such as Yes / No fully answers it.',
    'Do not call it when nothing changed. The session\'s open PRs are tracked separately; do not add them as items.',
  ].join('\n')
}

export function storedResult(count: number, title: string): string {
  return `Stored ${count} item(s) for "${title}".`
}

export function hiddenResult(ids: readonly string[]): string {
  return `The user already marked these ids done, so they stay hidden: ${ids.join(', ')}. Use a new id only for genuinely new work.`
}

export function subagentDeny(tool: string): string {
  return `${tool} is for the main session only; report pending items to the main agent instead.`
}

/** The deny reason for input that INPUT_ERRORS refused. */
export function inputDeny(tool: string, error: string): string {
  return `${tool}: ${error}`
}

export function storeFailedDeny(tool: string): string {
  return `${tool} failed to store the list.`
}

/** The deny reason when this session's file exists but is not valid; `reason` names the file, never its contents. */
export function invalidFileDeny(tool: string, reason: string): string {
  return `${tool} did not store the list: ${reason}. Tell the user; calling again fails until they fix or remove the file.`
}

/** Why the tool's input was refused, one per check. */
export const INPUT_ERRORS = {
  title: 'title must be a string',
  activity: 'activity must be a string',
  items: 'items must be an array',
  item: (index: number) => `items[${index}] must be an object`,
  id: (index: number) => `items[${index}].id must be a non-empty string`,
  duplicateId: (index: number, id: string) => `items[${index}].id "${id}" is duplicated`,
  kind: (index: number, kinds: readonly string[]) => `items[${index}].kind must be one of ${kinds.join(', ')}`,
  text: (index: number) => `items[${index}].text must be a non-empty string`,
  ownerUrl: (index: number) => `items[${index}].owner and url must be strings`,
  url: (index: number) => `items[${index}].url must be an https: URL`,
  tooLong: (field: string, max: number) => `${field} must be at most ${max} characters`,
  tooMany: (max: number) => `items must have at most ${max} entries`,
  options: (index: number, min: number, max: number, maxLength: number) =>
    `items[${index}].options is only for kind question, and must be ${min}-${max} distinct one-line strings of at most ${maxLength} characters`,
} as const

export const COMMAND_RESULT = 'Opened the Follow-ups pane.'

/** Each entry is `<id> (<item text>)`. */
export function doneNotice(entries: readonly string[]): string {
  return `[Follow-ups] The user marked these done in the pane: ${entries.join(', ')}`
}
