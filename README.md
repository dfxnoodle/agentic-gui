# Agentic GUI

Agentic GUI is a full-stack platform for AI-assisted project research and implementation planning. It gives non-technical or semi-technical teams a browser interface for running supported coding-agent CLIs against a configured codebase, reviewing the resulting analysis, and promoting approved plans into durable project memory.

The platform is designed around one constraint: AI suggestions should not silently become team decisions. Conversations can produce structured plans, plans must be reviewed, approved plans are checked against prior project memory, and only then are they committed into `MEMORY.md`.

## What The Platform Does

- Lets teams register local codebases as projects and assign a default CLI provider per project.
- Starts threaded conversations against a project using Claude Code, OpenAI Codex, Gemini CLI, Cursor CLI, or OpenCode.
- Streams agent output live into the UI over Server-Sent Events.
- Converts assistant analysis into structured implementation plans.
- Routes plans through approval, rejection, change request, contradiction checking, and commit-to-memory flows.
- Stores users, conversations, plans, projects, secrets, and roles in a simple file-backed JSON store.
- Supports role-based access through a dynamic role registry with a locked admin role and editable team-defined roles.

## Core Workflow

1. An admin or project manager adds a project in the Settings screen.
2. The project points to a local repository path and selects a default CLI provider.
3. A user starts a conversation and asks for research, feasibility analysis, or planning.
4. The backend runs the selected CLI in an isolated read-only workspace snapshot.
5. The response appears live in the chat UI.
6. A user can convert an assistant reply into a structured plan with `Plan & Save`.
7. A reviewer approves, rejects, or requests changes.
8. Approved plans are checked against existing `MEMORY.md` entries for contradictions.
9. If no conflicts are found, the approved plan is appended to project memory.

## Product Areas

### Frontend

The Vue app provides these main views:

- `Login`: username/password login backed by JWT auth.
- `Dashboard`: project summary, recent conversations, pending plans, and project memory/agents viewers.
- `Chat`: threaded conversation UI with streaming output, assistant selection, and optional second-opinion runs.
- `Plan Review`: approve, reject, force-commit, or delete plans and inspect contradiction results.
- `Project Setup`: edit project metadata, CLI provider, credential preference, and per-project runtime limits.
- `Settings`: manage users, roles, projects, provider authentication settings, and role permissions.

### Backend

The Express backend exposes:

- `/api/auth`: login, current user, and admin-only registration.
- `/api/conversations`: create threads, list/fetch/delete conversations, and send messages to a configured CLI.
- `/api/plans`: create plans from assistant messages, review plan versions, approve/reject/request changes, and commit approved plans.
- `/api/projects`: manage project records and read project-level `MEMORY.md` or `AGENTS.md`/`agents.md` content.
- `/api/events/:conversationId`: SSE endpoint for real-time conversation and plan events.
- `/api/admin`: user management, role management, provider credential configuration, and approval-role settings.

### Shared Package

The shared workspace package exports:

- core domain types for projects, conversations, plans, users, and streaming events
- plan-state transition rules
- role permission definitions and default seeded role templates
- supported CLI provider metadata and auth-mode definitions

## Architecture Summary

### Monorepo Layout

```text
.
├── packages/
│   ├── backend/   # Express API, file store, CLI runner, auth, SSE
│   ├── frontend/  # Vue 3 + Pinia + Vue Router app
│   └── shared/    # Shared types and constants
├── e2e/           # Playwright tests
├── scripts/       # Deployment bundling scripts
└── .env.example   # Required runtime configuration template
```

### How CLI Execution Works

For every conversation request, the backend:

1. Reads project context from `AGENTS.md` and `MEMORY.md` if present.
2. Builds a prompt tailored to the request type: research, feasibility, planning, or contradiction review.
3. Resolves credentials using either `platform_only` or `local_first` strategy.
4. Creates a read-only snapshot of the configured project path in a temporary workspace.
5. Spawns the selected CLI adapter and parses its structured streaming output.
6. Broadcasts normalized events to the frontend over SSE.
7. Persists assistant output to the conversation and optionally derives a structured plan from it.

This model keeps the source repository protected during analysis and planning while still allowing the agent tools to inspect the codebase.

### Storage Model

Data is stored under the backend data directory as JSON files with atomic writes:

- `users.json`
- `roles.json`
- `secrets.json`
- `conversations/*.json`
- `plans/*.json`
- `projects/*.json`

By default the data directory is `packages/backend/data`, but it can be overridden with `DATA_DIR`.

### Roles

The platform uses a dynamic role registry.

- `admin` is the reserved superuser role. It always keeps the full permission set and cannot be edited or deleted from the UI or API.
- Additional roles are stored in `roles.json` and can be created, renamed, re-permissioned, and deleted by an admin when no users are assigned to them.
- The default seed includes `project_manager` and `operations`, but they are now ordinary editable role definitions rather than hardcoded application roles.

Plan approval permissions are configurable by assigning or removing the `approve_plan` permission from roles in the admin settings UI. Those changes are persisted through the role registry.

## Supported Providers

Agentic GUI supports these CLI providers out of the box:

- Claude Code
- OpenAI Codex CLI
- Gemini CLI
- Cursor CLI
- OpenCode

The backend expects the CLI binaries to be installed and available on `PATH`:

- `claude`
- `codex`
- `gemini`
- `cursor`
- `opencode`

### Authentication Modes

Provider credentials can come from environment variables or from values saved in the admin UI.

Supported environment variables:

- Claude Code: `ANTHROPIC_API_KEY`
- OpenAI Codex: `CODEX_API_KEY`
- OpenAI Codex with Azure OpenAI: `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_MODEL` (optional: `CODEX_MODEL_REASONING_EFFORT`)
- Gemini CLI: `GEMINI_API_KEY`
- Cursor CLI: `CURSOR_API_KEY`
- OpenCode supports multiple auth modes in the Settings UI, including:
  - OpenAI via `OPENAI_API_KEY`
  - Anthropic via `ANTHROPIC_API_KEY`
  - Google Gemini via `GOOGLE_GENERATIVE_AI_API_KEY`
  - OpenRouter via `OPENROUTER_API_KEY`
  - Ollama local models via inline OpenCode config generated by the platform

OpenCode can also use its own local project or user configuration, including:

- `opencode.json` or `opencode.jsonc` in the project root
- `.opencode/` in the project root
- `~/.config/opencode/opencode.json` or `~/.config/opencode/opencode.jsonc`
- `~/.local/share/opencode/auth.json`

Gemini also supports a Vertex AI mode through saved provider configuration:

- `GOOGLE_GENAI_USE_VERTEXAI=true`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `GOOGLE_APPLICATION_CREDENTIALS` for an optional service account file path

### Credential Preference

Each project can choose one of two credential strategies:

- `platform_only`: only use centrally configured platform credentials
- `local_first`: try project-local or user-local CLI login first, then fall back to platform credentials

## Requirements

- Node.js 20 or newer
- npm 10 or newer recommended
- At least one supported CLI installed locally
- A root `.env` file based on `.env.example`

## Getting Started

### 1. Install dependencies

```bash
npm ci
```

### 2. Create the root environment file

```bash
cp .env.example .env
```

Set real values for every field in `.env`. The backend refuses to start if:

- `.env` is missing
- `ADMIN_USERNAME` or `ADMIN_PASSWORD` is empty
- the example placeholder admin values were not changed

Current template:

```env
PORT=3001
FRONTEND_PORT=5173
# Optional override when the frontend is served from a different origin.
# CORS_ORIGIN=http://localhost:5173
JWT_SECRET=replace-with-a-long-random-string
AGENTIC_GUI_SECRET_KEY=replace-with-a-long-random-string
ADMIN_USERNAME=replace-admin-username
ADMIN_PASSWORD=replace-admin-password
```

### 3. Start the app in development

```bash
npm run dev
```

This starts:

- the backend on `http://localhost:3001`
- the frontend on `http://localhost:5173` by default

To expose the frontend to other devices on the local network (e.g. for testing on mobile or another machine), use:

```bash
npm run dev:expose
```

Vite will print both the `localhost` and `Network` URLs on startup.

You can also run each side separately:

```bash
npm run dev:backend
npm run dev:frontend
```

### 4. Sign in with the bootstrap admin account

On first startup, the backend creates the initial admin user from `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the root `.env` file.

### 5. Configure a project and provider

In the UI:

1. Open `Settings`.
2. Add a project by pointing it at a local repository path.
3. Choose the default CLI provider for that project.
4. Configure provider authentication in the `CLI Config` tab if needed.
5. Open the project setup page to tune max turns, max runtime, and watchdog timeout.
6. Use the `Roles` tab if you need to create new team roles or update permissions on non-admin roles.

## Developer Scripts

```bash
npm run dev
npm run dev:expose
npm run dev:backend
npm run dev:frontend
npm run build
npm run build:shared
npm run build:backend
npm run build:frontend
npm run test
npm run test:backend
npm run test:e2e
npm run deploy:production
```

## Testing

### Backend tests

The backend uses Vitest for service and runner tests, including:

- plan parsing and state transitions
- prompt building
- provider adapter behavior
- credential strategy
- concurrency limiting
- read-only workspace behavior

Run them with:

```bash
npm run test:backend
```

### End-to-end tests

Playwright covers the login flow and authenticated navigation.

It requires the root `.env` file to contain valid `ADMIN_USERNAME` and `ADMIN_PASSWORD`, then starts:

- a backend with `DATA_DIR=/tmp/agentic-gui-e2e`
- the frontend dev server

Run E2E tests with:

```bash
npm run test:e2e
```

## Plan And Memory Lifecycle

Plans move through these states:

- `pending_review`
- `approved`
- `rejected`
- `revision_requested`
- `committed`

Important behavior:

- plans are parsed from AI-generated Markdown
- a top-level `## Summary` section is stored as plan summary metadata rather than as a regular section
- approved plans trigger an automated contradiction check against `MEMORY.md`
- successful approvals append a detailed record to `MEMORY.md`
- if contradictions are found, a reviewer can still force-commit the plan

`MEMORY.md` is treated as the source of truth for already-approved decisions, and `agents.md` or `AGENTS.md` is treated as project-specific instruction context.

## Role Management

Admins can manage roles directly from the `Settings` screen:

- create new roles with a generated stable role ID
- rename existing non-admin roles
- assign permissions such as `configure_projects`, `manage_users`, or `approve_plan`
- delete non-admin roles only when they are no longer assigned to any users

The frontend also treats `admin` as locked even if an older role payload omits the `system` flag, so the admin role cannot expose an active delete action in the UI.

## Deployment

Production bundling is handled by:

```bash
npm run deploy:production
```

This runs the deployment script in `scripts/deploy-production.sh`, which:

- runs `npm ci` by default for reproducible builds
- builds the shared, backend, and frontend workspaces
- creates a release directory under `.deploy/releases/<release-name>`
- creates a tarball under `.deploy/<release-name>.tar.gz`
- includes backend and shared build output, frontend static assets, `.env.example`, a generated `DEPLOY.md`, and an example Nginx config

Useful options:

```bash
bash scripts/deploy-production.sh --help
bash scripts/deploy-production.sh --skip-install
bash scripts/deploy-production.sh --include-env
```

The generated deployment notes assume:

- Node.js 20+
- `npm ci --omit=dev` on the target host
- static hosting for `packages/frontend/dist`
- reverse proxying of `/api` and `/api/events` to the backend

## Operational Notes

- The frontend talks to the backend through `/api` and relies on the dev/prod server to proxy requests.
- SSE authentication works with either a Bearer token or a `?token=` query parameter so the browser `EventSource` API can connect.
- Cursor CLI runs are intentionally throttled to one concurrent job because the adapter accounts for known headless reliability issues.
- Gemini streaming must use `--output-format stream-json`.
- Provider secrets are masked when returned to the frontend admin screens.
- If OpenCode is installed but not visible to the backend process, set `OPENCODE_BIN` in the root `.env` to the absolute binary path. The backend also prepends common user bin directories such as `~/.local/bin` when spawning CLIs.

## Workspace References

- `packages/backend/src/index.ts`: backend startup and route registration
- `packages/backend/src/services/cli-runner/runner.service.ts`: provider abstraction, credential strategy, sandboxing, and process orchestration
- `packages/backend/src/services/plan.service.ts`: plan parsing, normalization, and status transitions
- `packages/backend/src/services/memory.service.ts`: approved-plan commit logic for `MEMORY.md`
- `packages/frontend/src/views/ChatView.vue`: conversation UI and streaming behavior
- `packages/frontend/src/views/PlanReviewView.vue`: approval and contradiction-review UI
- `packages/frontend/src/views/SettingsView.vue`: user, role, project, provider, and permission administration

## License

This project is licensed under the Apache License 2.0.

Apache-2.0 keeps the project permissive for commercial and open-source use while adding an explicit patent grant, which is a better default than MIT for a platform intended to be extended and integrated.

## Status

This repository is already structured for local development, backend testing, end-to-end testing, and production bundle generation. The main external dependency is local access to the supported agent CLIs and valid credentials for at least one provider.