# Plan: Claude CLI OAuth for Anthropic API Authentication

**Date:** 2026-03-09
**Status:** In progress — first integration attempt has a bug

## Problem

The gradient-bang bot requires `ANTHROPIC_API_KEY` to use Claude as the task agent LLM. The developer has a Claude Code Max subscription that includes API access, but using a separate API key incurs separate charges. We want to reuse the Claude Code CLI OAuth session instead.

## Reference

- Siftly implementation guide: `/Users/rymalia/projects/Siftly/docs/claude-cli-oauth-implementation-guide.md`
- Siftly source: `lib/claude-cli-auth.ts`

## How Claude CLI OAuth Works

1. Claude Code stores an OAuth token in the OS credential store (macOS Keychain, service: `Claude Code-credentials`)
2. The token is a JSON blob containing `claudeAiOauth.accessToken` (format: `sk-ant-oat01-...`)
3. The Anthropic SDK accepts this via `auth_token=` parameter (sends `Authorization: Bearer` header)
4. The beta header `anthropic-beta: oauth-2025-04-20` is required on every request
5. Tokens expire — developer must run `claude` to refresh

## Integration Strategy

### The Pipecat Hook

Pipecat's `AnthropicLLMService.__init__` (in `.venv/.../pipecat/services/anthropic/llm.py` line 183):

```python
def __init__(self, *, api_key: str, model: str, client=None, ...):
    self._client = client or AsyncAnthropic(api_key=api_key)
```

The `client=` parameter lets us inject a pre-built `AsyncAnthropic` instance. When provided, Pipecat uses it directly and never touches `api_key` for client construction.

### Auth Resolution Order

```
1. ANTHROPIC_API_KEY env var (if non-empty)  →  api_key mode (existing behavior)
2. Claude CLI OAuth (keychain)                →  auth_token mode via injected client
3. Error with clear message                   →  tells user to set key or sign into CLI
```

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/gradientbang/utils/claude_cli_auth.py` | **Create** | Read OAuth token from OS credential store, return `AsyncAnthropic` client |
| `src/gradientbang/utils/llm_factory.py` | **Modify** | Wire OAuth fallback into `_create_anthropic_service()` |
| `.env.bot` | **Modify** | Fix model name, update comments |
| `env.bot.example` | **Modify** | Same fixes for template |

### `claude_cli_auth.py` — Design

```
read_cli_credentials()
  ├── macOS: shell out to `security find-generic-password -s "Claude Code-credentials" -w`
  ├── Linux/Win: read ~/.claude/.credentials.json
  ├── Parse JSON → ClaudeOAuthCredentials dataclass
  └── Cache result for 60 seconds (keychain lookup is ~50-200ms)

create_async_anthropic_client()
  ├── Call read_cli_credentials()
  ├── Check token expiry (expiresAt is milliseconds)
  ├── Return AsyncAnthropic(auth_token=..., default_headers={"anthropic-beta": "oauth-2025-04-20"})
  └── Return None if unavailable or expired
```

### `llm_factory.py` — Changes

1. `_get_api_key()`: Return `None` for Anthropic when env var is empty/unset (instead of raising). This lets the caller try CLI OAuth.
2. `_create_anthropic_service()`: When `api_key` is `None`, call `create_async_anthropic_client()`. If it returns a client, pass it via `client=` to Pipecat. If not, raise with instructions.

### Important Edge Cases

- **Empty string vs None**: `ANTHROPIC_API_KEY=` in `.env.bot` sets the env var to `""`, not unset. Must normalize: `(os.getenv(var) or "").strip() or None`.
- **Pipecat still requires `api_key` param**: Even when `client=` is provided, the constructor signature requires `api_key: str`. Pass a placeholder like `"unused-cli-oauth"`.
- **Multiple service instances**: The task agent creates a NEW `AnthropicLLMService` per task (lazy factory pattern at `task_agent.py:1106`). Each invocation goes through `_default_llm_service_factory()` → `create_llm_service()`. OAuth should work for all of them since the credential is cached.

## Expected Outcome

With `TASK_LLM_PROVIDER=anthropic` and no `ANTHROPIC_API_KEY`:
- Bot startup: no error (voice and UI use Google)
- First task triggered: logs `Using Claude CLI OAuth (subscription: max)`, creates working `AnthropicLLMService`
- API calls billed to Claude subscription, not API console

## Current Bug (to investigate)

`AnthropicLLMService#0` errors with `"Could not resolve authentication method"` before the CLI OAuth log appears. Possible causes:
1. There's a code path creating an Anthropic service that doesn't go through `llm_factory.create_llm_service()`
2. The placeholder `api_key="unused-cli-oauth"` confuses the SDK's `_validate_headers` check when combined with the injected client
3. `load_dotenv` or `set -a && source .env.bot` interaction causes the empty key to get picked up differently than expected
4. The `_SystemCachedAnthropicLLMService` subclass overrides something that breaks the injected client's auth headers

### Next debugging steps
- Add a log line at the top of `_create_anthropic_service()` to confirm it's being called for the failing instance
- Check if `api_key="unused-cli-oauth"` causes the SDK to set BOTH `x-api-key` and `Authorization` headers (conflicting)
- Verify the injected client's `_validate_headers` passes when called through Pipecat's `beta.messages.create`
