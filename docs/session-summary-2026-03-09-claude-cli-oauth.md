# Session Summary: Claude CLI OAuth for Anthropic API Auth

**Date:** 2026-03-09
**Duration:** ~1.5 hours
**Branch:** `dev`
**Objective:** Use Claude Code CLI subscription auth instead of a separate `ANTHROPIC_API_KEY` for the game's task agent

## Result

Working. The bot's task agent (Anthropic Claude Sonnet 4.6) now authenticates using the developer's Claude Code Max subscription OAuth token from the macOS Keychain. No `ANTHROPIC_API_KEY` needed. Verified with live gameplay — tasks execute successfully through Pipecat's pipeline.

## Key Decisions Made

- Implemented OAuth at the **application layer** (gradient-bang), not in Pipecat source — uses Pipecat's existing `client=` constructor parameter to inject a pre-configured `AsyncAnthropic` client
- Used the Siftly project's implementation guide (`/Users/rymalia/projects/Siftly/docs/claude-cli-oauth-implementation-guide.md`) as reference
- Chose to wrap `client.beta.messages.create` rather than subclassing Pipecat's `AnthropicLLMService`, keeping the integration surface minimal

## Changes Made

| Change | Detail |
|--------|--------|
| **New `claude_cli_auth.py`** | `src/gradientbang/utils/claude_cli_auth.py` — reads OAuth token from OS credential store, creates `AsyncAnthropic` with Bearer auth |
| **`llm_factory.py` — OAuth fallback** | `_create_anthropic_service()` tries CLI OAuth when no API key is available, injects pre-built client via Pipecat's `client=` param |
| **`llm_factory.py` — empty key handling** | `_get_api_key()` normalizes `""` to `None` with `(os.getenv(var) or "").strip() or None` |
| **`llm_factory.py` — beta wrapper** | Wraps `client.beta.messages.create` to append `oauth-2025-04-20` to the betas list on every call |
| **`llm_factory.py` — model defaults** | Updated Anthropic default model from `claude-sonnet-4-5-20250929` to `claude-sonnet-4-6` (2 locations) |
| **`env.bot.example` — model fix** | `claude-claude-sonnet-4-6` (double prefix typo) → `claude-sonnet-4-6` |
| **`env.bot.example` — comment fix** | `# requires ANTHROPIC_API_KEY` → `# uses Claude CLI OAuth, or ANTHROPIC_API_KEY` |
| **`.env.bot` — model fix** | Same model name correction (local config, not committed) |
| **`docs/plan-claude-cli-oauth.md`** | Design plan document with architecture, integration strategy, and debugging notes |

## Bugs Found and Fixed

### 1. Empty `ANTHROPIC_API_KEY=""` treated as valid by Anthropic SDK

**Symptom:** `"Could not resolve authentication method"` error even with OAuth token set.

**Root cause chain:**
1. `.env.bot` has `ANTHROPIC_API_KEY=` (empty string)
2. `set -a && source .env.bot` sets the env var to `""` in the shell
3. `os.getenv("ANTHROPIC_API_KEY")` returns `""` (not `None`)
4. Our `_get_api_key()` originally treated `""` as falsy-but-present, skipping the error but still passing it through
5. Even when we pass `api_key=None` to `AsyncAnthropic()`, the SDK constructor does `if api_key is None: api_key = os.environ.get("ANTHROPIC_API_KEY")` — picking up the `""` again
6. The SDK's `_api_key_auth` property checks `if api_key is None` (not falsy), so `""` produces `{"X-Api-Key": ""}`
7. `auth_headers` checks `if self._api_key_auth:` — a dict with one key is truthy, so it returns the X-Api-Key dict instead of the Authorization Bearer dict
8. `_validate_headers` finds no valid auth: `api_key=""` is falsy (fails line 396), and `Authorization` header is missing (fails line 401)

**Fix:** Two-pronged:
- `_get_api_key()` now normalizes: `(os.getenv(env_var) or "").strip() or None`
- `create_async_anthropic_client()` temporarily `os.environ.pop("ANTHROPIC_API_KEY")` during client construction, then restores it

### 2. Pipecat's `betas` parameter overrides OAuth beta header

**Symptom:** OAuth token present but API rejects with auth error.

**Root cause:** Pipecat hardcodes `betas=["interleaved-thinking-2025-05-14"]` in both `_process_context` (line 430) and `run_inference` (line 305). The SDK converts this to `extra_headers["anthropic-beta"] = "interleaved-thinking-2025-05-14"`. In `_build_headers`, `_merge_mappings({**default_headers}, custom_headers)` uses `{**obj1, **obj2}` — second dict wins, so the per-request `anthropic-beta` overwrites our `default_headers["anthropic-beta": "oauth-2025-04-20"]`.

**Fix:** Instead of relying on `default_headers`, wrap `client.beta.messages.create` to always append `oauth-2025-04-20` to the `betas` kwarg list before the SDK converts it to a header.

### 3. Double-prefix model name `claude-claude-sonnet-4-6`

**Symptom:** Log showed `model=claude-claude-sonnet-4-6` — not a real model.

**Root cause:** Typo in `env.bot.example` (upstream), propagated to `.env.bot` during setup.

**Fix:** Corrected to `claude-sonnet-4-6` in both files.

## How the OAuth Integration Works

```
Developer runs `claude` (Claude Code CLI)
       ↓
  Claude Code stores OAuth token in macOS Keychain
  (service: "Claude Code-credentials")
       ↓
  Bot starts with TASK_LLM_PROVIDER=anthropic, no ANTHROPIC_API_KEY
       ↓
  llm_factory._get_api_key() returns None for Anthropic
       ↓
  llm_factory._create_anthropic_service() calls claude_cli_auth
       ↓
  claude_cli_auth reads token from Keychain via `security` CLI
  (cached 60 seconds, ~50-200ms per lookup)
       ↓
  Creates AsyncAnthropic(auth_token="sk-ant-oat01-...")
  (env var stashed to prevent empty ANTHROPIC_API_KEY poisoning)
       ↓
  Wraps client.beta.messages.create to append oauth-2025-04-20 to betas
  (prevents Pipecat's betas=["interleaved-thinking-..."] from overriding)
       ↓
  Injects client via Pipecat's client= parameter
  (Pipecat line 207: self._client = client or AsyncAnthropic(api_key=...))
       ↓
  Every API call sends:
    Authorization: Bearer sk-ant-oat01-...
    anthropic-beta: interleaved-thinking-2025-05-14,oauth-2025-04-20
       ↓
  Billed to Claude Code subscription, not API console
```

## SDK Internals Learned

These are worth documenting because they're non-obvious and would bite anyone doing this integration:

1. **`AsyncAnthropic(api_key=None)` still reads `ANTHROPIC_API_KEY` from env** — the constructor explicitly falls back to `os.environ.get("ANTHROPIC_API_KEY")` when `api_key is None`. You must prevent the env lookup if you want pure `auth_token` mode.

2. **`""` is not `None` in the SDK's auth chain** — `_api_key_auth` checks `if api_key is None: return {}`, so `""` produces `{"X-Api-Key": ""}` which is truthy and wins over `_bearer_auth` in `auth_headers`.

3. **`betas` kwarg becomes `extra_headers["anthropic-beta"]`** which is merged via `{**default_headers, **extra_headers}` — second dict wins, so per-request betas override default_headers betas entirely. They don't merge.

4. **Pipecat's `client=` parameter is the integration hook** — `self._client = client or AsyncAnthropic(api_key=api_key)` at line 207. When `client` is provided, `api_key` is never used for client construction. But Pipecat's constructor signature still requires it, so pass a placeholder.

5. **Token format**: OAuth tokens are `sk-ant-oat01-...`, API keys are `sk-ant-api...`. The SDK distinguishes them by which HTTP header is used, not by the token prefix.

## Commit Readiness Assessment

**Verdict: Ready to commit with caveats.**

### What's solid
- The OAuth integration is clean and self-contained (1 new file + 1 modified file)
- Fallback behavior is preserved: if CLI OAuth fails, falls back to `ANTHROPIC_API_KEY` as before
- No changes to Pipecat source code or any dependencies
- Tested end-to-end with live gameplay
- The `env.bot.example` model name fix is a clear bugfix

### Caveats to note
- **Local dev only**: OAuth tokens come from the developer's Keychain. This won't work in Pipecat Cloud or Docker production — those still need `ANTHROPIC_API_KEY`. The code handles this gracefully (falls back to API key).
- **Token expiry**: OAuth tokens expire (~5 hours). If the bot runs longer than that, the task agent will start failing. The user must run `claude` to refresh. Consider adding a retry-with-refresh mechanism in a future session.
- **Thread safety**: The module-level cache in `claude_cli_auth.py` uses globals without a lock. Safe for async (GIL), but would need a `threading.Lock` if the bot ever used threads.
- **The `betas` wrapper is a monkey-patch**: If the Anthropic SDK changes the `beta.messages.create` signature, this could break. It's the cleanest option given Pipecat's hardcoded betas, but worth a comment in case of future SDK upgrades.
- **`os.environ.pop` during construction**: Briefly removes `ANTHROPIC_API_KEY` from the environment. Safe in practice (single-threaded construction), but technically a race condition if another thread reads the env var at that exact moment.

### Recommended commit scope
The following files are safe to commit together as a single feature:
- `src/gradientbang/utils/claude_cli_auth.py` (new)
- `src/gradientbang/utils/llm_factory.py` (modified)
- `env.bot.example` (bugfix)

Files NOT to commit:
- `.env.bot` — local config with API keys
- `docs/plan-claude-cli-oauth.md` — working document, useful for reference but not needed in repo
- `docs/session-summary-2026-03-09-fresh-setup.md` — from previous session, separate concern
- `deployment/supabase/functions/deno.lock` — deletion from previous session
- `artifacts/universe-map.svg` — generated artifact

### Suggested commit message

```
Add Claude CLI OAuth fallback for Anthropic API auth

Allow developers with Claude Code subscriptions to use their existing
OAuth session instead of a separate ANTHROPIC_API_KEY. Reads the token
from the OS credential store (macOS Keychain / ~/.claude/.credentials.json)
and injects it via Pipecat's client= parameter.

Also fixes double-prefix model name typo in env.bot.example
(claude-claude-sonnet-4-6 → claude-sonnet-4-6).
```
