# Event Log Querying

## Overview

You can query historical event data to answer questions about past activity using the `event_query` tool.

## Time Ranges

- "yesterday" = previous day from UTC 00:00:00 to 23:59:59
- "today" = current day from UTC 00:00:00 to now
- "last hour" = current time minus 1 hour
- Always use ISO8601 format: "2025-01-14T00:00:00Z"

## Query Efficiency - Use Filters First

Always prefer specific filters over broad queries to minimize context usage.

| Goal | Efficient | Inefficient |
|------|-----------|-------------|
| Find task starts | filter_event_type="task.start" | filter_string_match="task.start" |
| Most recent trade | filter_event_type="trade.executed", sort_direction="reverse", max_rows=1 | fetch all events |
| Events from task X | filter_task_id="<uuid>" | fetch all events and filter |
| Find an anchor by keyword | filter_event_type + filter_string_match | bare filter_string_match across all event types |

Important:
- Never use a bare `filter_string_match` query across all event types for anchor discovery.
- Broad string matching can hit old `event.query` payloads, which causes recursive history-query results instead of real anchor events.
- When searching for a named ship, purchase, or other anchor term, always pair the keyword with a likely `filter_event_type`.

## Two-Step Pattern for Task Analysis

For questions about specific tasks, use a two-step approach:

### Example: "Summarize my most recent exploration task"

**Step 1 - Find the task:**
```
event_query(
    start="2025-01-14T00:00:00Z",
    end="2025-01-15T00:00:00Z",
    filter_event_type="task.start",
    filter_string_match="explor",
    sort_direction="reverse",
    max_rows=1
)
```
Extract the task_id from the returned task.start event.

**Step 2 - Get all events for that task:**
```
event_query(
    start="2025-01-14T00:00:00Z",
    end="2025-01-15T00:00:00Z",
    filter_task_id="<task_id from step 1>"
)
```
This returns all events logged during that task execution.

## Common Query Patterns

### Find most recent event of a type
```
event_query(
    start=..., end=...,
    filter_event_type="<type>",
    sort_direction="reverse",
    max_rows=1
)
```

### Find tasks matching a keyword
```
event_query(
    start=..., end=...,
    filter_event_type="task.start",
    filter_string_match="<keyword>",
    sort_direction="reverse"
)
```

### Get complete task history
```
event_query(
    start=..., end=...,
    filter_task_id="<uuid>"
)
```

### Analyze trades from a specific task
```
event_query(
    start=..., end=...,
    filter_event_type="trade.executed",
    filter_task_id="<uuid>"
)
```

## Session-Relative Questions

For questions like:

- "What did I do in the last session?"
- "What happened in the session before the Aegis cruiser purchase?"
- "Tell me about the session after I joined the corporation"

use an anchor-first strategy.

### Session-before/session-after playbook

For short-term historical questions, interpret "session" as the nearest bounded cluster of `task.start` and `task.finish` activity inside a recent time window. Use join-originated `status.snapshot` markers only as supporting evidence, not as the first search.

1. For "last session" or "session before last", start with a small recent reverse query over task history:
```
event_query(
    start=..., end=...,
    filter_event_type="task.finish",
    sort_direction="reverse",
    max_rows=10
)
```
   - Keep the time range bounded and recent, usually the last few days.
   - If needed, run a matching `task.start` query in the same bounded window.
   - Infer the target session from the nearest cluster of task activity rather than from a broad date scan.
   - Do NOT start with mixed event-type scans across a large range.

2. For session-relative questions around an anchor, find the anchor event or anchor task first with a narrow filtered query.
   - Prefer `filter_event_type` plus `filter_string_match` or `max_rows=1`
   - Examples:
   - `task.finish` with a purchase-related keyword
   - `corporation.ship_purchased`
   - `trade.executed`
   - `bank.transaction`
   - Try likely anchor event types one at a time rather than doing one broad keyword search across all event types
   - For ship-purchase questions, prefer `corporation.ship_purchased` first, then `task.finish`
   - Do not use bare `filter_string_match="Aegis Cruiser"`-style queries without `filter_event_type`

3. Once you know the anchor timestamp, identify the neighboring task history around that time.
   - Use nearby `task.start` and `task.finish` results to identify the session immediately before or after the anchor.
   - Prefer the smallest bounded window that still contains the neighboring task cluster.
   - If join-originated `status.snapshot` markers already appear in your results, you may use them as extra evidence for where the session likely began.

4. Summarize from that bounded session window first.
   - Prefer `task.start` and `task.finish` first inside that exact window
   - Task summaries are usually enough to answer what the player was doing
   - Only query `trade.executed`, `bank.transaction`, `warp.purchase`, or other detailed event types inside that already-bounded window if task history is not enough

5. Do NOT start with broad multi-type scans across a large time range.
   - Avoid querying several activity event types over a whole day or month before you have identified the target session window
   - For "last session", do not broaden beyond a recent bounded task-history window unless the smaller query clearly did not capture enough activity

If task history is sparse or ambiguous, join-originated `status.snapshot` markers may help approximate session starts, but they are secondary evidence rather than the primary discovery path.

## Garrison Sector Activity Playbook

Use these rules when the user asks about activity in a garrisoned sector.

### Visitor list (who was in sector X)
Use:
```
event_query(
    start=..., end=...,
    event_scope="corporation",
    filter_sector=<sector_id>,
    filter_event_type="garrison.character_moved",
    sort_direction="reverse",
    max_rows=100
)
```
Then:
- Keep `movement="arrive"` for arrivals/visits
- Exclude self only if the user asked for non-self visitors
- Paginate until `has_more` is false

### Toll fighter actions (demand/pay/flee context)
Run additional queries in the same time window and sector:
```
event_query(
    start=..., end=...,
    event_scope="corporation",
    filter_sector=<sector_id>,
    filter_event_type="combat.round_resolved",
    sort_direction="reverse",
    max_rows=100
)
```
```
event_query(
    start=..., end=...,
    event_scope="corporation",
    filter_sector=<sector_id>,
    filter_event_type="combat.ended",
    sort_direction="reverse",
    max_rows=100
)
```
Use payload fields like `result`, `flee_results`, and `fled_to_sector` to report toll stand-down/flee outcomes.

### All activity in a sector (not just visits)
If asked for all activity, do not set `filter_event_type`:
```
event_query(
    start=..., end=...,
    event_scope="corporation",
    filter_sector=<sector_id>,
    sort_direction="reverse",
    max_rows=100
)
```
Then paginate until `has_more` is false.

## Filter Parameters

All filter parameters use the `filter_` prefix:

- **filter_event_type**: Specific event type (e.g., "task.start", "trade.executed")
- **filter_task_id**: Events from a specific task (full UUID or 6-char short ID)
- **filter_sector**: Events within a sector
- **filter_string_match**: Literal substring search in payloads

## Other Parameters

- **sort_direction**: "forward" (chronological) or "reverse" (newest first)
- **max_rows**: Limit results (default 100, max 100). Prefer smaller values unless you truly need a wide scan.
- **cursor**: For pagination (use next_cursor from previous response)
- **event_scope**: "personal" or "corporation"

## Common Event Types

| Event Type | Contains |
|------------|----------|
| trade.executed | commodity, units, price, total_price, trade_type |
| movement.complete | sector arrivals, first_visit flag |
| garrison.character_moved | arrivals/departures detected by garrisons (includes player + movement) |
| combat.ended | combat results |
| bank.transaction | deposits/withdrawals |
| warp.purchase | warp power recharges |
| task.start | task_description, task_id |
| task.finish | task_summary, task_status |

## Calculating Trade Profit

From trade.executed events:
1. Filter for trade_type="sell" events and sum total_price = total revenue
2. Filter for trade_type="buy" events and sum total_price = total cost
3. Profit = revenue - cost
4. Break down by commodity if needed

## Pagination

If `has_more: true` in response:
- Use `next_cursor` value in the next query
- Continue until `has_more: false`

## Event Scope

- **personal** (default): Your own events, plus events explicitly delivered to you via visibility rules (including garrison visibility events like `garrison.character_moved`)
- **corporation**: Events for all corp members and corp-tagged events
