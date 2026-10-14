// The tool's input schema, registered at session start. Built from the same limits and kinds
// parseSetInput checks, and the field descriptions in prompts.ts. Pure: register.tsx registers it.
import { KINDS, LIMITS, OPTION_MAX_LENGTH, OPTIONS_MAX, OPTIONS_MIN } from './parse'
import { INPUT_DESCRIPTIONS } from './prompts'

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: LIMITS.id, description: INPUT_DESCRIPTIONS.id },
    kind: { type: 'string', enum: KINDS },
    text: { type: 'string', maxLength: LIMITS.text, description: INPUT_DESCRIPTIONS.text },
    owner: { type: 'string', maxLength: LIMITS.owner, description: INPUT_DESCRIPTIONS.owner },
    url: { type: 'string', maxLength: LIMITS.url, description: INPUT_DESCRIPTIONS.url },
    options: {
      type: 'array',
      items: { type: 'string', maxLength: OPTION_MAX_LENGTH },
      minItems: OPTIONS_MIN,
      maxItems: OPTIONS_MAX,
      description: INPUT_DESCRIPTIONS.options,
    },
  },
  required: ['id', 'kind', 'text'],
}

// Exactly one of items and changes, and title with items: parseSetInput checks both, so no field is required here.
export const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: LIMITS.title, description: INPUT_DESCRIPTIONS.title },
    activity: { type: 'string', maxLength: LIMITS.activity, description: INPUT_DESCRIPTIONS.activity },
    items: { type: 'array', maxItems: LIMITS.items, items: ITEM_SCHEMA, description: INPUT_DESCRIPTIONS.items },
    changes: {
      type: 'object',
      properties: {
        upsert: { type: 'array', maxItems: LIMITS.items, items: ITEM_SCHEMA, description: INPUT_DESCRIPTIONS.upsert },
        remove: {
          type: 'array',
          maxItems: LIMITS.items,
          items: { type: 'string', maxLength: LIMITS.id },
          description: INPUT_DESCRIPTIONS.remove,
        },
      },
      additionalProperties: false,
      description: INPUT_DESCRIPTIONS.changes,
    },
  },
}
