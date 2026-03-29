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

"Session" = nearest bounded cluster of `task.start`/`task.finish` activity. Use an anchor-first strategy:

### Playbook

1. **Find the anchor** — narrow filtered query first:
   - "Last session" → query recent task history:
   ```
   event_query(
       start=..., end=...,
       filter_event_type="task.finish",
       sort_direction="reverse",
       max_rows=10
   )
   ```
   - Anchor by name → pair `filter_event_type` (e.g., `corporation.ship_purchased`, `trade.executed`) with `filter_string_match`. Never bare `filter_string_match` without `filter_event_type`

2. **Identify session window** — use nearby `task.start`/`task.finish` around the anchor timestamp. Keep the window as small as possible.

3. **Summarize** — task summaries first. Only query `trade.executed`, `bank.transaction`, etc. if task history is insufficient.

Rules:
- Never start with broad multi-type scans across large time ranges
- `status.snapshot` markers are secondary evidence only, not the primary search path
- Always keep time ranges bounded and recent

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
