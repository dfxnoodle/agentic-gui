# Headless orchestration from a TypeScript backend for Claude Code, OpenAI Codex, Gemini CLI, and Cursor CLI

## Scope and sources

This report focuses on running four “coding agent” CLIs in a headless (non-interactive) way from a Node.js/TypeScript backend, and when it is more robust to use the corresponding TypeScript SDKs instead. It covers the CLIs and official SDKs associated with entity["company","Anthropic","ai company"], entity["company","OpenAI","ai company"], entity["company","Google","technology company"], and entity["company","Anysphere","cursor maker"], using primary sources from official documentation and open-source repositories hosted on entity["company","GitHub","code hosting platform"]. citeturn2view1turn2view0turn7view2turn14view0turn19view0turn21view0turn22view0turn32view0

A key caveat: at the time of research (6 Apr 2026), Cursor’s documentation pages under `cursor.com/docs/...` did not render into readable text in the crawler view used here (they appear to be client-rendered). For Cursor, this report triangulates headless usage and flags from Cursor’s public CLI pages/blog and from Cursor community forum threads, plus search-index snippets of the official docs (which preserve some critical flag metadata). citeturn25view0turn32view0turn33search3turn33search2turn36view0turn36view1turn36view2turn36view3

## A reusable backend architecture for “headless CLI as an agent worker”

The stable pattern across all four ecosystems is to treat each agent run as a **job** executed inside an isolated workspace, with a strongly structured output channel that your backend can parse and stream to clients.

At a high level:

- A **job runner** (a container or VM) checks out or copies code into a **workspace directory**.
- Your TypeScript backend spawns the tool’s headless CLI mode and captures:
  - `stdout` for structured output (JSON or JSONL/NDJSON event streams).
  - `stderr` for progress/log output (some tools intentionally stream progress on `stderr` for easy `stdout` piping). citeturn8view3
- The backend converts the tool’s streaming events into your own event protocol (SSE/WebSocket), persists artifacts (diffs, patches, JSON outputs), and enforces safety (timeouts, concurrency caps, and sandbox rules).

All four ecosystems expose some form of “structured output” suitable for this design:
- Claude Code supports `--output-format json` and `--output-format stream-json`, and even schema-validated JSON via `--json-schema`. citeturn4view0turn4view3  
- Codex supports JSON Lines mode (`codex exec --json`) and schema-constrained final output via `--output-schema`. citeturn8view0turn14view2  
- Gemini CLI headless supports both a single JSON object output and a newline-delimited streaming JSON event format. citeturn19view0turn21view1  
- Cursor CLI exposes `--output-format` values including `json` and `stream-json` (NDJSON), with `--output-format` only enabled when running headless/print mode. citeturn33search3turn33search2turn36view1  

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Anthropic logo","OpenAI logo","Google Gemini logo","Cursor AI editor logo"],"num_per_query":1}

A practical design decision for a TypeScript backend is whether to:
- **Shell out to the CLI** for agentic file edits, shell commands, and tool integrations; or
- **Call the provider SDK directly** when you want predictable request/response semantics, tighter rate-limit control, and simpler authentication boundaries (especially in multi-tenant backends). citeturn6view0turn11view0turn22view0

The sections below analyse each ecosystem’s headless mode and how to wire it into a TypeScript backend.

## Claude Code and Anthropic TypeScript integration

### Headless execution model and output contracts

Claude Code’s current documentation frames “headless mode” as **running Claude Code programmatically via the Agent SDK**, with the same CLI options as before. Headless/non-interactive CLI runs are triggered by the `-p` / `--print` flag. citeturn2view1turn4view0

Key points for backend orchestration:

- **Non-interactive invocation:** “Add `-p` to any `claude` command to run it non-interactively.” The docs explicitly call out that CLI options like `--continue`, `--allowedTools`, and `--output-format` work with `-p`. citeturn2view1turn4view0  
- **Determinism and startup time:** `--bare` is recommended for scripted runs: it skips auto-discovery of hooks, plugins, MCP servers, auto memory, and `CLAUDE.md`, producing more consistent results across machines and faster startup. citeturn2view1turn4view1  
- **Structured outputs:** `--output-format` supports `text`, `json`, and `stream-json`. For schema-constrained JSON, there is `--json-schema`, which returns validated JSON matching a JSON Schema. citeturn4view0turn4view3  
- **Guardrails for automation:** `--max-budget-usd` caps spend; `--max-turns` caps agentic turns; and `--no-session-persistence` disables saving sessions to disk (useful when jobs must not leave local state). citeturn4view0  

### Authentication and configuration isolation

Claude Code offers both an authenticated user experience (Claude subscriptions) and API-key-based usage.

- If `ANTHROPIC_API_KEY` is set, the CLI uses it as the `X-Api-Key` header. In non-interactive mode (`-p`), the key is **always** used when present. In interactive mode, Claude Code prompts once before letting the env var override your subscription. citeturn3view0  
- You can isolate all CLI state (settings, credentials, session history, plugins) via `CLAUDE_CONFIG_DIR`, which overrides the default `~/.claude`. This is particularly important for a backend that runs jobs for multiple tenants; you generally want a per-job or per-tenant config directory rather than a shared global config. citeturn3view2  
- The settings system is explicitly scoped (managed/user/project/local), and the docs suggest API keys and auth are typically stored in user scope. For a backend worker, you’ll usually want to *avoid* inheriting a developer’s personal `~/.claude` by default. citeturn2view3turn3view2  

Operational env-var knobs that matter in automation include options to disable non-essential traffic and telemetry, and an `exit-after-stop` delay that can help jobs terminate cleanly after becoming idle. citeturn35view0turn35view2  

### TypeScript integration options

Claude gives you two viable patterns:

1) **Spawn the CLI headlessly** (best when you want Claude Code’s full tool loop—read/edit files, run bash, MCP tools—inside an isolated workspace).

2) **Use the TypeScript SDK directly** (best when you want to call the model API without agentic file ops, or when you want strict control over retries and rate limits).

For direct API calls, the official TypeScript SDK (`@anthropic-ai/sdk`) uses `ANTHROPIC_API_KEY` by default and supports server-side Node.js (Node 18+). citeturn6view0  

For “Claude Code-like agents,” Anthropic positions the Claude Agent SDK as the programmatic way to “build AI agents with Claude Code’s capabilities” and installable via `npm install @anthropic-ai/claude-agent-sdk`. citeturn5view0turn2view1  

### Concrete headless CLI patterns to embed in a backend

In practice, your backend wrapper typically chooses one of these output modes:

- `--output-format json` → parse once at end.
- `--output-format stream-json` → parse line-delimited events and stream them to clients.

A representative (CLI-level) job shape is:

```bash
# Deterministic, fast startup; streams JSON events; pre-approves tools.
CLAUDE_CONFIG_DIR=/tmp/claude-job-123 \
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
claude --bare -p "Fix failing unit tests" \
  --allowedTools "Read,Edit,Bash" \
  --output-format stream-json \
  --max-turns 6 \
  --no-session-persistence
```

This pattern is grounded in Claude Code’s documentation for `-p`, `--bare`, `--allowedTools`, `--output-format`, `--max-turns`, and `--no-session-persistence`, and the ability to isolate config state via `CLAUDE_CONFIG_DIR`. citeturn2view1turn4view0turn4view1turn3view2  

## OpenAI Codex CLI and OpenAI Node SDK

### Headless execution model: `codex exec`

OpenAI’s Codex documentation treats **non-interactive mode** as a first-class automation feature:

- You run Codex headlessly via `codex exec` (non-interactive mode), which “lets you run Codex from scripts…without opening the interactive TUI.” citeturn8view3  
- In this mode, Codex “streams progress to `stderr` and prints only the final agent message to `stdout`,” which is a strong default for Unix pipelines (you can `| tee`, redirect, etc.). citeturn8view3  
- If you want a machine-consumable event feed, `codex exec --json` turns `stdout` into a JSONL stream of events (including turn lifecycle and “item.*” events for tool actions). citeturn8view0  

Codex also bakes in explicit automation controls:

- `--ephemeral` avoids persisting run artifacts (“session rollout files”) to disk. citeturn8view3turn14view3  
- It defaults to a **read-only sandbox** in `codex exec`; for automation you can broaden permissions:
  - Edits: `--full-auto`
  - Broader access: `--sandbox danger-full-access` (explicitly warned as only for isolated environments). citeturn8view3turn14view2turn14view3  
- For schema-stable downstream automation, Codex supports `--output-schema`, with `-o/--output-last-message` to persist the final result. citeturn8view0turn14view2  

A backend-quality detail: Codex CLI can read the prompt from `stdin` by passing `-` for the `PROMPT` positional argument, which is useful to avoid shell quoting limits or to dynamically generate prompts. citeturn14view0  

### Authentication and state management for automation

Codex supports interactive login, but for automated CI usage:

- The docs recommend API key auth for CI: set `CODEX_API_KEY` as a secret env var, or set it inline for a single run. Importantly, `CODEX_API_KEY` is only supported in `codex exec`. citeturn8view0turn12view0  
- If you instead reuse account-based auth, the docs warn that `~/.codex/auth.json` contains access tokens and must be treated like a password (do not share/commit; avoid for public repositories). citeturn8view0  

For tool integrations, the CLI reference indicates MCP server entries are stored in `~/.codex/config.toml` (and can be managed with `codex mcp ...`). This is relevant because, in backend workers, you typically want to control or isolate this state per job by setting HOME/XDG roots. citeturn14view1  

### TypeScript integration options

OpenAI offers a complementary approach to “shell out to Codex CLI”:

- Use the official Node/TypeScript client (`openai`) directly. It defaults to reading `OPENAI_API_KEY` and supports both the Responses API and chat completions. citeturn11view0turn11view3  
- The SDK has operational features that are naturally useful in a backend: built-in streaming support, default retries (including for 429 rate limits), and configurable timeouts. citeturn11view3  

This choice often comes down to **agentic file operations vs pure API calls**:
- Codex CLI is suited when you want the terminal-based agent loop, with sandboxing and local repo actions. citeturn8view3turn12view0  
- `openai-node` is suited when you want API-level control, multi-tenant concurrency management, and explicit handling of rate limits. citeturn11view3turn10view0  

### Rate limits as a backend constraint

OpenAI rate limits are multidimensional (RPM, RPD, TPM, TPD, IPM), defined at organization and project levels, and vary by model. The docs also describe how rate limits can be inspected via response headers (e.g., `x-ratelimit-remaining-requests`, `x-ratelimit-reset-tokens`). citeturn10view2turn10view0  

For a TypeScript backend running multiple headless jobs, those headers (available when you use the SDK directly) are a practical way to drive **adaptive throttling** and avoid burst failures, whereas the CLI path typically requires treating retries and throttling as an external orchestration concern. citeturn10view0turn11view3  

## Gemini CLI and Google GenAI SDK

### Headless execution model and output contracts

Gemini CLI has an explicitly documented “headless mode”:

- Headless mode is triggered when the CLI runs **in a non-TTY environment** or when supplying a prompt with `-p` / `--prompt`. citeturn19view0turn21view0  
- You can select output structure via `--output-format`. The headless reference describes:
  - **JSON output**: a single JSON object with `response`, `stats`, and optional `error`. citeturn19view0  
  - **Streaming JSON output**: newline-delimited JSON events (JSONL) with event types including `init`, `message`, `tool_use`, `tool_result`, and `result`. citeturn19view0  
- In the automation tutorial, Gemini CLI’s headless mode is positioned as “perfect” for CI/CD, batch processing, and scripting, and shows piping `stdin` to provide file/command context. citeturn21view0turn21view3  

Gemini CLI provides explicit exit codes for automation (e.g., `0` success, `42` input error, `53` turn limit exceeded), which is useful when you need predictable job failure classification in a backend. citeturn19view0  

### Authentication options that matter in headless/CI

Gemini CLI supports multiple authentication modes:

- For “Gemini API key” use, you set `GEMINI_API_KEY` (from Google AI Studio). citeturn20view0turn20view2  
- For Vertex AI usage, the docs list multiple auth methods and the required project/location env vars:
  - Set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. citeturn20view3  
  - Use ADC via `gcloud`, a service account JSON key (explicitly called out as a good fit for CI/non-interactive environments), or a `GOOGLE_API_KEY` for Vertex AI if your org permits it. citeturn20view3turn20view0  

Gemini CLI also supports loading env vars from a `.env` file under `.gemini/.env` (searched from the current directory upward, then in the home directory), which can be helpful in ephemeral runners where you mount secrets into the workspace. citeturn20view2  

### SDK path: `@google/genai` and unified “Developer API vs Vertex AI” semantics

For a TypeScript backend that does **not** need to shell out, Google’s official Gemini API quickstart shows the GenAI SDK flow:

- Install with `npm install @google/genai`.
- Instantiate `GoogleGenAI`, which reads the API key from `GEMINI_API_KEY`. citeturn22view0turn22view2  

For Vertex AI specifically, Google Cloud documentation describes the “Google Gen AI SDK” as a unified interface across the Gemini Developer API and the Gemini API on Vertex AI, where “with a few exceptions, code that runs on one platform will run on both.” It also documents the env var switch for Vertex usage (`GOOGLE_GENAI_USE_VERTEXAI=True`) alongside `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. citeturn24view2  

This matters for backend architecture because it lets you standardise codepaths:
- Prototype with Developer API keys in lower-risk environments, then move to Vertex AI for enterprise governance without rewriting the integration. citeturn24view2  

### Rate limits and scheduling considerations

Gemini API rate limits are typically evaluated across RPM, TPM, and RPD, and are applied **per project** rather than per API key. The docs state that RPD quotas reset at midnight Pacific time. citeturn16view0  

For headless job orchestration, the “per project” scoping implies you should prefer:
- separate projects per environment (dev/staging/prod), and sometimes per tenant, when you need isolation in a multi-tenant backend. citeturn16view0  

## Cursor CLI and Cursor APIs for backend orchestration

### Headless CLI entrypoints, based on public sources

Cursor’s public CLI landing page advertises installation via a shell script, and positions the CLI as a way to “ship code with agents…right from your terminal,” including “headless” usage for scripts/automation. citeturn25view0turn32view0  

Cursor’s blog post announcing the CLI provides the clearest “official” headless-adjacent setup guidance accessible here:
- Install via a `curl ... | bash` flow.
- Start with a prompt using `agent chat "find one bug and fix it"`.
- The CLI is “still in beta” and “security safeguards are still evolving”; it can read/modify/delete files and execute shell commands you approve—so it should be used only in trusted environments. citeturn32view0turn25view0  

For “true headless runs,” the most concrete flag-level details available in accessible sources come from Cursor’s community forum plus search-indexed doc snippets:

- A Cursor forum response (Mar 12, 2026) states that `--prompt` is not a valid flag, and that headless/non-interactive runs require `--print` (or `-p`) to print output to stdout; it also calls out `--trust` (skip workspace trust prompts) and `--yolo` / `--force` (run without confirmation) for automation. citeturn36view0  
- A bug report thread (Jan 29, 2026) uses `cursor agent -p --output-format text "Say hello"` and suggests that `--output-format stream-json` exists for streaming output in print mode. citeturn36view1  
- Search-indexed snippets from Cursor’s docs indicate:
  - `--output-format` only works with `--print`, and supported formats include `text`, `json`, and `stream-json` (default: `text`). citeturn33search3  
  - `stream-json` emits newline-delimited JSON (NDJSON) events, one JSON object per line. citeturn33search2  
  - There is an additional `--stream-partial-output` flag for partial/streamed output. citeturn33search3  

### Authentication and Cursor APIs

Cursor’s search-indexed docs describe two authentication modes for the CLI: browser-based login (recommended) and API keys. citeturn33search0  

Forum threads show how this tends to appear in CI:

- API keys are passed either via an environment variable (`CURSOR_API_KEY`) or via a `--api-key` flag, and a `cursor-agent status` check is used to validate whether auth is working. citeturn36view2turn33search0  
- Cursor staff mention real-world CI issues (TLS/connectivity) against an API endpoint `api2.cursor.sh`, where “invalid API key” can mask connectivity problems in CI runners. citeturn36view2  

For programmatic control beyond the CLI, Cursor’s API overview (as captured by search snippets) suggests Cursor provides multiple APIs (including Cloud Agents) and that Cursor APIs use **Basic Authentication** with an API key. citeturn33search1  

This implies a common backend strategy:
- Prefer an API-based integration for long-running, multi-tenant, or highly reliable orchestration; and
- Use the CLI primarily for “bring your own environment” workflows where the agent runs alongside a checked-out repo and developers want the same behaviour as their terminal toolchain. citeturn33search1turn32view0  

### Reliability caveats specific to headless Cursor runs

Unlike the other three ecosystems (which document mature non-interactive modes), Cursor’s headless mode appears to have some operational sharp edges in the field:

- Multiple users report that `-p` / print mode can hang indefinitely with no output, while interactive mode works. citeturn36view1  
- Another report describes a race condition where launching two headless `cursor-agent` processes nearly simultaneously causes one to exit status 1 with no output; the reported workaround is serial execution with a small delay, which reduces throughput for backend orchestrators. citeturn36view3  

For a TypeScript backend, this suggests you should treat Cursor CLI jobs as **potentially non-terminating** unless you enforce timeouts and hard-kill semantics, and you should cap concurrency for Cursor runners more aggressively than for Claude/Codex/Gemini until the headless mode behaviour is stable. citeturn36view1turn36view3  

## Comparative integration notes and a practical TypeScript approach

### Headless modes and output streams compared

| Ecosystem | Headless trigger | Structured output | Streaming events | Key automation safety knobs |
|---|---|---|---|---|
| Claude Code | `claude -p` (print mode); optional `--bare` for deterministic startup citeturn2view1turn4view1 | `--output-format json`; schema validation via `--json-schema` citeturn4view0turn4view3 | `--output-format stream-json` (JSONL) citeturn4view0 | `--allowedTools`, permission modes; `--max-turns`, `--max-budget-usd`, `--no-session-persistence` citeturn4view0turn4view1 |
| Codex CLI | `codex exec` (non-interactive mode) citeturn8view3turn14view0 | `--output-schema` + `-o` for stable final JSON; default final message on stdout citeturn8view0turn14view2 | `codex exec --json` (JSONL event stream) citeturn8view0 | default read-only sandbox; `--sandbox …`, `--full-auto`, `--yolo`; `--ephemeral` citeturn8view3turn14view3turn14view2 |
| Gemini CLI | Non-TTY or `-p/--prompt` citeturn19view0turn21view0 | `--output-format json` returns `{response, stats, error?}` citeturn19view0turn21view1 | Streaming JSON output described as JSONL events (`tool_use`, `tool_result`, etc.) citeturn19view0 | Exit codes for automation; auth via `GEMINI_API_KEY` or Vertex methods citeturn19view0turn20view0turn20view3 |
| Cursor CLI | `--print/-p` for headless output (community-confirmed); `--output-format` only works with `--print` citeturn36view0turn33search3 | `--output-format json` (docs snippet) citeturn33search3 | `--output-format stream-json` emits NDJSON events (docs snippet; forum also references stream-json) citeturn33search2turn36view1 | `--trust`, `--yolo/--force` for automation (forum); real-world headless hangs + concurrency issues reported citeturn36view0turn36view1turn36view3 |

### A TypeScript “runner” pattern that works across Claude/Codex/Gemini/Cursor

For a backend that supports multiple CLIs, a practical approach is to standardise on **streaming JSONL/NDJSON** when available and convert it into a unified event model.

A minimal cross-CLI parsing strategy in Node is:

- Spawn the process with `child_process.spawn`.
- Read `stdout` line-by-line (Node `readline`) and parse JSON per line.
- Read `stderr` for logs (and optionally forward it as “log” events).
- Enforce:
  - a max runtime timeout,
  - a “no output for N seconds” watchdog,
  - and a max-concurrency limiter.

This maps naturally onto:
- Claude `--output-format stream-json` citeturn4view0  
- Codex `codex exec --json` citeturn8view0  
- Gemini streaming JSON output citeturn19view0  
- Cursor `--output-format stream-json` citeturn33search2turn36view1  

### When to prefer SDKs over spawning CLIs

In headless, multi-tenant backends, the SDK route often wins for predictability and rate-limit control:

- Anthropic’s server-side TypeScript SDK is straightforward (`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`). citeturn6view0  
- OpenAI’s Node SDK provides streaming and retries (including explicit defaults for 429 and timeouts). citeturn11view3  
- Google’s GenAI SDK (`@google/genai`) standardises on `GEMINI_API_KEY`, and Google’s Vertex docs highlight a single codebase can work across Developer API and Vertex AI (with env var switches). citeturn22view0turn24view2  

CLIs remain valuable when your backend must execute **agentic tool loops over a real filesystem** (editing files, running shell commands, calling MCP tools) and you want behaviour aligned with developer-facing terminal agents. Codex, Claude Code, and Gemini CLI all explicitly document headless automation modes that support this workflow. citeturn2view1turn8view3turn21view3  

Cursor’s CLI can support similar workflows, but field reports indicate you should currently budget engineering time for operational mitigations (timeouts, retries, and serialisation) when using it headlessly at scale. citeturn36view1turn36view3