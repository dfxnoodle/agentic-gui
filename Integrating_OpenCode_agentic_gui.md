# Integrating OpenCode into the agentic-gui alongside existing CLI tools

## 1. Background: Existing CLI adapters in agentic-gui
The `agentic-gui` project already includes adapters for popular AI coding agents like Claude Code, Codex CLI, Gemini CLI, and Cursor CLI. These adapters live in `packages/backend/src/services/cli-runner/adapters` and expose a uniform event stream to the front-end. Each adapter constructs a command to launch the underlying CLI, configures environment variables and flags, and then parses JSON-streamed events to emit unified event types (text, thinking, progress, tool-use, tool-result, and error).

### Existing Adapters Summary
| Agent | Command Construction & Environment | Event Types & Parsing |
| :--- | :--- | :--- |
| **Claude Code** | Spawns `claude --bare -p <prompt> --output-format stream-json` with optional remote, concurrency and timeouts. Environment variables like `ANTHROPIC_API_KEY` (and `CLAUDE_API_KEY`) are set before running. | Parses streamed JSON events (assistant, content_block_delta, tool_use, tool_result, result, error etc.) into unified events: text, thinking, tool-use/result and errors. |
| **Codex CLI** | Spawns `codex exec-json ephemeral` with optional `--full-auto`. When using remote mode, it sets `CODEX_API_KEY`. | Parses JSON events such as message, content_delta, item.created, item.completed, turn.completed and error, mapping them to unified events. |
| **Gemini CLI** | Runs `gemini -p <prompt> --output-format stream-json`, sets `GEMINI_API_KEY` and optional concurrency/timeouts. | Handles event types like init, message, text_delta, tool_use, tool_result, result and error. |
| **Cursor CLI** | Executes `cursor agent -p --output-format stream-json-trust <prompt>` with concurrency and detection of hangs. It uses environment variables from `cursorrc` plus `CURSOR_API_KEY` if present. | Parses events such as assistant, content_block_delta, tool_use tool_result, result, error and status/system. Additional logic retries the command if a hang is detected. |

The adapters unify these agents by converting their different event streams into a common format and by exposing a consistent interface to the front-end.

---

## 2. About OpenCode
OpenCode is a relatively new, open-source AI coding agent written in Go. It is designed to be extensible, supports over 75 model providers, and can run in the terminal, IDE, or as a desktop app. The project emphasises privacy (no code or context is stored) and allows the user to use their existing AI subscriptions. It can also be extended with hooks and external tools. Unlike some proprietary agents, it is free and community maintained.

OpenCode can be run non-interactively using `opencode -p "<prompt>" -f json q` or `opencode run --format json --prompt <prompt>`. These commands output a JSON object (or stream of JSON lines if using `run`), and there are flags for quiet mode and output format.

### 2.1 Event Streaming Format
OpenCode supports streaming when running as a server (`opencode serve`) or via the non-interactive `run` command with `--format json`. A community "stream JSON cheatsheet" describes the event types emitted in JSON-line mode:

| Event Type | Description | Key Fields |
| :--- | :--- | :--- |
| `step_start` | Emitted when a new reasoning step begins. Includes a name (e.g., plan), a sessionId, and the step number. | `sessionId`, `name`, `step`, `timestamp`. |
| `tool_use` | Emitted whenever the agent calls an internal tool. Contains tool name, args, and an id referring to the tool call. | `tool`, `args`, `sessionId`, `id`. |
| `text` | Contains partial or final content produced by the agent. Each piece is a delta string. | `part` (text), `sessionId`. |
| `step_finish` | Emitted when a reasoning step completes. It includes reason (e.g., stop or tool-calls) and cost metrics. | `sessionId`, `reason`, `step`, `usage`. |
| `error` | Emitted when an error occurs during processing. | `sessionId`, `err`. |

This streaming format differs slightly from the event structures emitted by the other CLIs but provides enough information to map to the common event schema used in `agentic-gui`.

### 2.2 Extensibility and Hooks
* OpenCode is designed to be highly extensible.
* A guide on hooks explains that one can build plugins that intercept tool execution, modify prompts, or enforce policies.
* An SDK (`@opencode-ai/sdk`) enables subscription to server-sent events when running `opencode serve`.
* This means `agentic-gui` could either call the CLI directly or run OpenCode in server mode and subscribe to events.
* For simplicity and parity with existing adapters, we propose using the CLI and JSON-streamed events first, with the possibility of an SSE integration later.

---

## 3. Proposed Integration Strategy for agentic-gui

### 3.1 Installation & Prerequisites
1.  **Install OpenCode** on the host machine (developers and CI). OpenCode provides a one-line installer: `curl -fsSL https://opencode.ai/install | bash`. This script adds the opencode binary to the PATH. Alternatively, download the binary from the releases page. Ensure the version is at least v0.7.0 (the first to support `run --format json`).
2.  **Configure providers**. Create `~/.config/opencode/opencode.json` (or project-level `opencode.json`) specifying allowed model providers and API keys. This ensures that the CLI can access the same providers configured for Claude and Codex. API keys can be injected via environment variables using dotenv or `secrets.service`.
    ```json
    {
      "providers": {
        "openai": {
          "apiKey": "${OPENAI_API_KEY}"
        },
        "anthropic": {
          "apiKey": "${ANTHROPIC_API_KEY}"
        }
      },
      "permissions": {
        "read": "allow",
        "write": "ask",
        "execute": "deny"
      }
    }
    ```
   
3.  **Optional: run as a server**. For real-time SSE streaming or multi-session usage, run `opencode serve`. This exposes an HTTP endpoint at `localhost:5000` that can stream events. The proposed initial integration will rely on CLI streaming; SSE integration could be added later to support interactive sessions.

### 3.2 Adding OpenCode to the list of CLI providers
1.  Add a provider constant in `packages/backend/src/constants/cli-providers.ts`:
    ```typescript
    export const CLI_PROVIDERS = [
      "claude",
      "codex",
      "gemini",
      "cursor",
      "opencode"
    ] as const;
    export type CliProvider = typeof CLI_PROVIDERS[number];
    ```
   
    This allows the front-end drop-down to show OpenCode.
2.  Update configuration schema (`ConfigSpec`) to include `opencode` as an allowed preferred Provider. Provide default concurrency and timeouts similar to other CLIs.

### 3.3 Implementing opencode.adapter.ts
Create a new adapter at `packages/backend/src/services/cli-runner/adapters/opencode.adapter.ts` based on existing adapters. Key responsibilities:

1.  **Build command:** Use the non-interactive `opencode run` with JSON output:
    ```javascript
    const cmd = [
      "opencode",
      "run",
      "--prompt", prompt, // send the prompt
      "--format", "json", // JSON-line format
      "--quiet"           // hide spinners/progress bars
    ];
    ```
   
    * If concurrency/timeouts are required, use environment variables like `OPENCODE_MAX_STEPS` or command flags; default values can mirror other adapters (e.g., `-timeout 60000` if supported). At present, OpenCode does not implement concurrency flags, so rely on its built-in step limits and ask the user to adjust in `opencode.json`.
    * **Set environment variables:** Merge environment variables from `secrets.service` for API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) into the spawn options. Also set `NO_COLOR=1` to avoid ANSI codes.
    * **Parse events:** Read the stdout stream line by line (each line is a JSON object). Use `JSON.parse` on each line and map event types:

| OpenCode Event | Unified Event in agentic-gui |
| :--- | :--- |
| `text` | Emit `{ type: "text", content: data.part }` whenever `event.type === "text"`. |
| `tool_use` | Emit `{ type: "tool_use", name: data.tool, args: data.args, requestId: data.id }`. In OpenCode, tools include built-in ones like bash, edit, write, grep, etc. The adapter should map them to the existing tool runner, or if unsupported, emit a progress event indicating a tool call. |
| `step_start` | Represent as a progress event, e.g., `{ type: "thinking", content: "Starting step " + data.step + " (" + data.name + ")" }`. This matches how other adapters emit thinking events for plan/analysis. |
| `step_finish` | Another progress event summarising the step result. If `data.reason === "tool-calls"`, the adapter knows tool calls were made; if `reason === "stop"`, the conversation ended. It can also forward cost metrics to the UI. |
| `error` | Emit `{ type: "error", content: data.err }`. |

* The adapter should be resilient to unknown event types; log them but continue streaming.
* **Handle process lifecycle:** If `opencode` exits with a non-zero status, propagate an error event. Support cancellation by killing the process when the user stops the run.

### 3.4 UI & Tool Integration
* **Front-end changes:** Update the provider selection list to include OpenCode. Display the provider's description (e.g., "Open-source AI coding agent with 75+ model providers"). The UI should allow the user to configure providers through the `opencode.json` file or secrets service.
* **Tool execution:** Many OpenCode tools overlap with built-in tools in other adapters (e.g., bash and edit). For unsupported tool names, you may implement wrappers that call the corresponding tool via `agentic-gui` or warn the user. Because OpenCode is extensible via custom hooks, advanced integrations could expose project-specific tools through the `@opencode-ai/sdk`, but this is an optional enhancement.

### 3.5 Error Handling & Concurrency Considerations
OpenCode's event stream can include incomplete or long-running steps. The adapter should:
* Buffer partial text events and flush them periodically to maintain responsiveness, similar to the other adapters.
* Detect and handle errors early by watching error events and process exit codes.
* Avoid concurrent runs by locking the adapter when one session is active; OpenCode does not support concurrent sessions via the CLI by default.
* Provide a timeout (e.g., 10 minutes) after which the process is killed and an error is emitted.

---

## 4. Comparison with Existing CLI Tools
The integration of OpenCode brings several advantages compared with proprietary CLIs:
1.  **Licensing and cost:** OpenCode is open-source and free to use; it allows the same provider subscriptions as other agents. In contrast, Claude Code and Cursor CLI require subscriptions or API keys, and may not be open source.
2.  **Extensibility:** OpenCode's hook system and SDK permit custom tools, event subscriptions and server-side integration. Existing adapters mainly rely on each CLI's built-in tool system.
3.  **Model diversity:** OpenCode supports 75+ providers via a unified config, whereas the other CLIs are tied to one or two providers. This allows the user to experiment with different models and cost settings.
4.  **Privacy and local context:** OpenCode emphasises that it never stores code or context and runs locally. This may appeal to privacy-conscious users.

**Potential drawbacks include:**
* **Maturity:** As a newer project, OpenCode's CLI and streaming features may be less polished than long-established tools like Codex or Gemini. For instance, the stream format uses different field names, and concurrency features are still evolving.
* **Tool compatibility:** Some built-in tools in OpenCode (e.g., grep, glob) may not match existing `agentic-gui` semantics and will need wrappers.

---

## 5. Future Enhancements
* **SSE integration:** To support interactive sessions where the agent stays alive across multiple user prompts, integrate with `opencode serve` using the SDK's SSE subscription API. This would enable the front-end to maintain a persistent connection and avoid spawning a new process per prompt.
* **Custom hooks:** Write OpenCode hooks to restrict file access or automatically run formatting tools. For example, a plugin could deny reading `.env` files or auto-format code after each edit tool call.
* **Multi-session support:** Use `sessionId` fields to multiplex events from multiple prompts to the correct UI session, enabling parallel tasks.

## 6. Summary
Integrating OpenCode into `agentic-gui` is feasible and will provide users with an open, extensible alternative to proprietary coding agents. By constructing a new adapter that runs `opencode run format json quiet-prompt <prompt>`, parsing its JSON event stream, and mapping event types to the existing unified schema, the project can support another powerful AI tool. After adding the provider to the configuration and UI, users can experiment with numerous model providers while staying within the familiar `agentic-gui` experience.
