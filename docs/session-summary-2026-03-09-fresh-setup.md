# Session Summary: Fresh Local Dev Setup

**Date:** 2026-03-09
**Duration:** ~2 hours
**Objective:** Set up Gradient Bang local development environment from scratch and get the game running

## Key Decisions Made

- Used `/init` skill to orchestrate full setup (Supabase, Python deps, world gen, env files)
- Created NPC character `TESTNPC` for bot testing (character_id: `e0433e76-586e-49a5-bf41-3618ae62e4e6`)
- Added `EDGE_ADMIN_PASSWORD=localdev` to `.env.supabase` to enable admin endpoints (character_create, etc.)
- Deleted stale `/Users/rymalia/projects/.env` containing old Vertex AI/gcloud credentials
- Deleted `deployment/supabase/functions/deno.lock` (version 5 incompatible with edge runtime's Deno 2.1.4)
- User enabled Google AI Studio billing to overcome free-tier rate limits (20 RPM)

## Changes Made

| Change | Detail |
|--------|--------|
| **Python deps** | `uv sync --all-groups` installed all dependencies |
| **Supabase started** | `npx supabase start --workdir deployment/` — all Docker services running |
| **`.env.supabase` created** | Auto-generated from `supabase status` output + random EDGE_API_TOKEN |
| **`EDGE_ADMIN_PASSWORD` added** | Added `localdev` to `.env.supabase` for admin endpoints |
| **`BOT_START_URL` fixed** | Moved inline comment to its own line (Supabase edge runtime doesn't strip inline `# comments`) |
| **DB reset + cron** | Ran `scripts/supabase-reset-with-cron.sh` |
| **World data loaded** | 5000 sectors (seed 1234) + quest definitions |
| **`.env.bot` created** | From `env.bot.example`, populated with API keys + Supabase values |
| **`.env.bot` DAILY_API_KEY fix** | Removed space around `=` (`DAILY_API_KEY = ` → `DAILY_API_KEY=`) |
| **NPC character created** | `TESTNPC` via `character_create` edge function |
| **`BOT_TEST_CHARACTER_ID` set** | Set in `.env.bot` for bot startup |
| **`deno.lock` deleted** | Version 5 lockfile incompatible with supabase-edge-runtime-1.71.0 (Deno 2.1.4) |
| **Parent `.env` deleted** | `/Users/rymalia/projects/.env` had `GOOGLE_GENAI_USE_VERTEXAI=1` forcing Vertex AI |
| **gcloud ADC deleted** | `~/.config/gcloud/application_default_credentials.json` removed |

## Issues Fixed & Gotchas

### 1. `deno.lock` version 5 incompatible with edge runtime
**Symptom:** `worker boot error: Unsupported lockfile version '5'` on every function invocation.
**Fix:** Delete `deployment/supabase/functions/deno.lock`. The runtime regenerates a compatible one.
**Note:** Remote has also deleted this file — no conflict on pull.

### 2. Supabase edge runtime doesn't strip inline env comments
**Symptom:** `POST /start%20 HTTP/1.1" 404 Not Found` — trailing space in URL.
**Cause:** `BOT_START_URL=http://host.docker.internal:7860/start # comment` — everything after `=` is the value, including ` # comment`.
**Fix:** Put comments on their own line in `.env` files used by Supabase edge functions.

### 3. `DAILY_API_KEY = ` with spaces causes shell parse error
**Symptom:** `.env.bot:16: command not found: DAILY_API_KEY` when sourcing.
**Cause:** `set -a && source .env.bot` treats `DAILY_API_KEY = # comment` as a command because of the space around `=`.
**Fix:** No spaces around `=` in env files.

### 4. Bot binding to localhost vs 0.0.0.0
**Symptom:** Edge functions (in Docker) get 404/connection refused when calling bot's `/start`.
**Cause:** `uv run bot` defaults to `localhost` (127.0.0.1), but Docker containers reach the host via `host.docker.internal` (192.168.65.254), which isn't localhost.
**Fix:** Always start bot with `--host 0.0.0.0`.

### 5. `GOOGLE_GENAI_USE_VERTEXAI=1` in parent directory `.env`
**Symptom:** `401 Unauthorized: API keys are not supported by this API` hitting `aiplatform.googleapis.com`.
**Cause:** `/Users/rymalia/projects/.env` contained old Vertex AI config. The `google-genai` SDK picks up `GOOGLE_GENAI_USE_VERTEXAI=1` and routes to Vertex AI even when an API key is explicitly passed.
**Fix:** Deleted the parent `.env` file. Also deleted stale `~/.config/gcloud/application_default_credentials.json`.
**Debugging insight:** Standalone Python tests worked because they didn't have the env var set. The var was being loaded by direnv or similar from the parent directory.

### 6. `EDGE_ADMIN_PASSWORD` not in default `.env.supabase`
**Symptom:** `character_create` endpoint returns 403 — admin password validation fails because no password is configured.
**Fix:** Added `EDGE_ADMIN_PASSWORD=localdev` to `.env.supabase`.
**Note:** The `/init` skill should probably include this step.

### 7. Google AI free tier rate limit (20 RPM for gemini-2.5-flash)
**Symptom:** `429 Too Many Requests` — quota exceeded after a few seconds of gameplay.
**Cause:** Bot runs 3 concurrent Google LLM services (voice, UI agent, context compression) that burn through 20 RPM instantly.
**Fix:** Enable billing on Google AI Studio project. Free tier is insufficient for this bot.

### 8. `BOT_TEST_CHARACTER_ID` required for local dev
**Symptom:** `RuntimeError: Set BOT_TEST_CHARACTER_ID (or BOT_TEST_NPC_CHARACTER_NAME)` on bot startup.
**Cause:** No characters exist in a fresh DB. Bot needs a character identity before it can start.
**Fix:** Create a character via `character_create` edge function, then set `BOT_TEST_CHARACTER_ID` in `.env.bot`.

## Correct Startup Sequence (Verified Working)

```bash
# Terminal 1: Edge functions
npx supabase functions serve --workdir deployment --no-verify-jwt --env-file .env.supabase

# Terminal 2: Bot (NOTE: --host 0.0.0.0 is required!)
set -a && source .env.bot && set +a && uv run bot --host 0.0.0.0

# Terminal 3: Client
cd client && pnpm i && pnpm run dev

# Browser: http://localhost:5173
# Login: kwindla@gmail.com / secret123 / player JOETRADER
```

## Architecture Insights

- **Prompts are composable:** `src/gradientbang/prompts/` has base game rules, agent-specific personality, and on-demand fragments loaded via `load_game_info()` tool calls
- **Audio files** in `client/app/src/assets/sounds/` are only UI SFX (chimes, warp, combat) — zero pre-recorded dialogue
- **Edge functions run in Docker** — `host.docker.internal` is the correct way to reach host services, not `localhost`

## AI/LLM Services Map

The game uses **5 distinct AI services** across 3 vendors, all orchestrated through Pipecat's real-time pipeline over WebRTC.

### The Real-Time Voice Pipeline

Audio flows through this chain in real time:

```
Player speaks into mic
       ↓
  [ Deepgram STT ]  ← Speech-to-Text (transcription only, not an LLM)
       ↓
  Raw text transcript
       ↓
  [ Gemini 2.5 Flash — Voice Agent ]  ← LLM: generates the ship AI's response
       ↓
  Response text
       ↓
  [ Cartesia TTS ]  ← Text-to-Speech (neural voice synthesis, not an LLM)
       ↓
  Player hears the ship AI speak
```

### All 5 AI Services

| # | Service | Vendor | What It Does | Model | API Key |
|---|---------|--------|-------------|-------|---------|
| 1 | **Speech-to-Text** | Deepgram | Transcribes player's voice to text. Not an LLM — it's a specialized ASR (automatic speech recognition) model. Runs continuously while mic is open. | Deepgram Nova (default) | `DEEPGRAM_API_KEY` |
| 2 | **Voice Agent LLM** | Google | The "brain" of the ship AI. Receives transcribed text, decides what to say, calls game tools (navigation, trading, combat). Drives the personality you hear. This is the main conversational LLM. | `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| 3 | **Text-to-Speech** | Cartesia | Converts the voice agent's text response into spoken audio. Not an LLM — it's a neural speech synthesis model. Uses a specific voice preset (voice_id: `ec1e269e`). | Cartesia Sonic (default) | `CARTESIA_API_KEY` |
| 4 | **Task Agent LLM** | Anthropic | Handles multi-step game actions (warp sequences, trading runs, exploration). Runs as an autonomous agent loop — receives a task, plans steps, calls edge functions, reports results. Uses extended thinking mode (2048 token budget). | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` |
| 5 | **UI Agent LLM** | Google | Monitors the conversation and controls the game client UI — switches panels, zooms the map, highlights sectors. Runs in parallel alongside the voice agent on a separate LLM context. Lightweight, no thinking mode. | `gemini-2.5-flash` | `GOOGLE_API_KEY` |

Plus one more internal service:

| # | Service | Vendor | What It Does | Model | API Key |
|---|---------|--------|-------------|-------|---------|
| 6 | **Context Compression** | Google | Background process that summarizes old conversation history when context grows too long (>200 messages). Prevents the voice agent from hitting context limits during long sessions. | `gemini-2.5-flash` | `GOOGLE_API_KEY` |

### How They Interact

```
                    ┌─────────────────────────────────┐
                    │         Pipecat Pipeline         │
                    │         (WebRTC transport)       │
                    └─────────┬───────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
     ┌────────▼──────┐  ┌────▼────┐  ┌───────▼───────┐
     │  Deepgram STT │  │ Cartesia│  │  SmallWebRTC  │
     │  (mic → text) │  │  TTS    │  │  (transport)  │
     └────────┬──────┘  │(text →  │  └───────────────┘
              │         │ speech) │
              │         └────▲────┘
              │              │
     ┌────────▼──────────────┴────────┐
     │   Voice Agent (Gemini 2.5 Flash)│
     │   - Ship AI personality         │
     │   - Direct tool calls           │
     │   - Delegates complex tasks ────┼──→ Task Agent (Claude Sonnet 4.5)
     └──────────┬─────────────────────┘      - Multi-step execution
                │                            - Extended thinking
                │
     ┌──────────▼─────────────────────┐
     │   UI Agent (Gemini 2.5 Flash)  │
     │   - Watches conversation       │
     │   - Controls client UI panels  │
     └───────────────────────────────┘
                │
     ┌──────────▼─────────────────────┐
     │   Context Compression (Gemini) │
     │   - Background summarization   │
     │   - Keeps context under limits │
     └───────────────────────────────┘
```

### Key Insight: Deepgram and Cartesia Are NOT LLMs

Deepgram (STT) and Cartesia (TTS) are specialized neural models, not general-purpose LLMs:
- **Deepgram** is an ASR model trained specifically on speech recognition. It converts audio waveforms to text — it doesn't "think" or generate responses.
- **Cartesia** is a neural TTS model that synthesizes speech from text. It produces natural-sounding voice output but doesn't understand or reason about content.

The actual "thinking" is done by the three LLM services: Gemini (voice + UI + compression) and Claude (tasks).

### Why Google Gets Hit So Hard (Rate Limit Context)

With your `.env.bot` defaults, Google handles **4 concurrent roles**: voice agent, UI agent, context compression, and — if no Anthropic key is set — the task agent too. That's why the free tier (20 RPM) was exhausted in seconds. Each player interaction triggers multiple parallel LLM calls across these services.

### Configuration (from `.env.bot`)

All LLM assignments are configurable via environment variables:

```bash
# Voice (ship AI personality) — default: Google Gemini
VOICE_LLM_PROVIDER=google
VOICE_LLM_MODEL=gemini-2.5-flash

# Task (multi-step actions) — default: Anthropic Claude
TASK_LLM_PROVIDER=anthropic
TASK_LLM_MODEL=claude-sonnet-4-5
TASK_LLM_THINKING_BUDGET=2048

# UI (client control) — default: Google Gemini
UI_AGENT_LLM_PROVIDER=google
UI_AGENT_LLM_MODEL=gemini-2.5-flash
```

Any of these can be swapped to `google`, `anthropic`, or `openai` — the factory in `src/gradientbang/utils/llm_factory.py` handles the abstraction.

### Why Google Is the Chokepoint (and Requires a Paid Account)

Gemini 2.5 Flash handles **4 out of 6 services simultaneously**, making it by far the most heavily loaded provider. Here's what happens when a player says a single sentence like "warp to sector 664":

**Calls triggered by one utterance:**

| Call | Service | Why |
|------|---------|-----|
| 1 | Voice Agent (Gemini) | Understand the request, generate ship AI's spoken response, decide to call `start_task` |
| 2 | UI Agent (Gemini) | Runs in parallel — watches the conversation, decides to zoom the map to sector 664 |
| 3 | Task Agent (Gemini or Claude) | Execute the multi-step warp: check fuel, move sector-by-sector, report results. May loop 3-5+ times for multi-hop routes |
| 4 | Context Compression (Gemini) | If context >200 messages, fires a summarization call in the background |

That's **3-5+ API calls from a single sentence**, all hitting Google's quota (unless Anthropic handles the task agent). During active gameplay, the player speaks every few seconds, and the voice agent + UI agent fire on every utterance. The rate stacks up fast:

- **Voice agent**: 1 call per player utterance (every ~5 seconds)
- **UI agent**: 1 call per player utterance (parallel)
- **Context compression**: periodic background calls (checking + summarizing)
- **Task agent**: bursts of 3-10+ calls during multi-step actions

**Conservative estimate for active gameplay: 20-30+ Google API calls per minute.**

The free tier limit of 20 RPM for `gemini-2.5-flash` is exhausted in under 10 seconds of active play. This is why billing is mandatory — the bot's architecture fundamentally requires high-throughput LLM access.

**By contrast, Deepgram and Cartesia are lightweight:**
- Deepgram processes a continuous audio stream (one persistent connection, not per-request)
- Cartesia synthesizes one audio chunk per voice agent response
- Neither requires the multi-call fan-out pattern that makes Google the bottleneck

**Claude (Anthropic) is bursty but infrequent:**
- Only fires when the voice agent delegates a task via `start_task`
- Runs an autonomous loop (plan → act → observe → repeat) that may make 3-10 inference calls per task
- But tasks are triggered by explicit player commands, not every utterance
- Uses extended thinking (2048 token budget) for better planning quality

### Source Files

| Component | File |
|-----------|------|
| Pipeline assembly | `src/gradientbang/pipecat_server/bot.py` |
| LLM factory | `src/gradientbang/utils/llm_factory.py` |
| Voice agent prompt | `src/gradientbang/prompts/agents/voice_agent.md` |
| Task agent prompt | `src/gradientbang/prompts/agents/task_agent.md` |
| UI agent prompt | `src/gradientbang/prompts/agents/ui_agent.md` |
| Task agent harness | `src/gradientbang/utils/task_agent.py` |
| UI agent | `src/gradientbang/pipecat_server/ui_agent.py` |
| Context compression | `src/gradientbang/pipecat_server/context_compression.py` |
| Prompt loader | `src/gradientbang/utils/prompt_loader.py` |
| Game mechanic fragments | `src/gradientbang/prompts/fragments/*.md` |

## Pending: Remote Has 27 New Commits

Remote `origin/main` is 27 commits ahead. No conflicts expected (only local change is deleted `deno.lock` which remote also deleted). Key upstream changes:
- Ghost ships fix, double tool calls fix, task agent event waiting fix
- Intro tutorial now non-dismissable
- New conversation panel UI
- Prompt improvements (contracts, mega-port hallucination reduction)
- Major client refactor (old ChatPanel removed, ~750 lines)

## Next Session Recommendations

1. **Pull and upgrade** — `git pull origin main && uv sync --all-groups && cd client && pnpm i`
2. **Re-run world data load** if DB schema changed (check migration files in the new commits)
3. **Test the new conversation panel** — major UI addition in the upstream changes
4. **Consider adding `ANTHROPIC_API_KEY`** to `.env.bot` to enable the task agent (currently skipped — multi-step actions like trading sequences won't work without it)
5. **Explore the `/init` skill improvements** — several gotchas found in this session should be fed back into the skill (inline comments, admin password, `--host 0.0.0.0`)
6. **Use `/playground` to create an interactive architecture visualization** — map out the full data flow across all 6 AI services, the Pipecat pipeline, Supabase edge functions, and the WebRTC transport. This session's AI services map section has all the source material needed to build a comprehensive interactive diagram
