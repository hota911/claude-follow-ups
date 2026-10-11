# Diff updates for `pending_items_set`

## Problem

The tool took only the full list: every call resent every item, even when one item changed.
In one measured session the model made 27 calls at about 1,400 output tokens each. Sending only
the changed and removed items would cut about 60% of those tokens, about 18% of all output
tokens of that session.

## Decision

The tool takes exactly one of two inputs:

- `items`: the full list. It replaces the stored list, as before. `title` is required.
- `changes`: `{ upsert?: Item[], remove?: string[] }`, only what changed. `title` is optional.

The prompt tells the model to send `changes` normally, and `items` on the first call or whenever
it is unsure what is stored. Every result ends with the stored ids and kinds, so the model can
recover the list after its context was compacted.

Example call and result:

```json
{ "changes": { "upsert": [{ "id": "q1", "kind": "question", "text": "Merge now?" }], "remove": ["old"] } }
```

```
Stored 2 item(s) for "Tidy the logs". Not in the list, so nothing to remove (already removed or marked done): old.
Current: q1 (question), merge (next_step).
```

## Rules

1. Both `items` and `changes`, or neither, is refused. With `changes`, an omitted `title` or
   `activity` keeps the stored one, and `activity: ""` clears it. With `items`, an omitted
   `activity` clears it, as before. `changes` may hold only `upsert` and `remove`.
2. `upsert`: an item whose id is stored replaces it in place; a new id is appended. Each item is
   checked as an `items` entry is (same limits). Duplicate ids in `upsert` or in `remove`, and an
   id in both, are refused. A list that would exceed 50 items is refused and nothing is written.
3. `remove`: drops those ids. An id that is not stored is not an error; the result names it.
4. Ids the user marked done stay hidden: an upserted one is not stored and the result names it,
   as with `items`.
5. The result's last line is `Current: <id> (<kind>), ...`, or `Current: none.`, after one line
   with the count, hidden ids and unknown removes. It is the same for `items` calls.
6. `changes` when this session has no file yet works as `items` with the upserts if it has a
   title; without a title it is refused, asking for a full `items` call.

## Alternatives considered

- Full list only (as before): simplest and always consistent, but pays the tokens above.
- Changes only: rejected. A model that forgets a removal leaves stale items forever, and after
  compaction the model no longer knows what is stored, so the list drifts from what it believes.
  Keeping `items` gives it a way to resynchronize, and the `Current:` line tells it when to.
