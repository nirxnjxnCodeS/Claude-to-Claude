# claude-context-bridge

A local MCP server that exposes your development context — git state, Claude Code session history, active diffs, TODOs, and build setup — as MCP tools. When you open Claude.ai, it already knows what you're working on.

---

## What it exposes

| Tool | What it returns |
|------|----------------|
| `get_project_context` | Repo name, branch, last 5 commits, git status, package.json info |
| `get_recent_claude_sessions` | Last 3 Claude Code sessions with timestamps and first prompts |
| `get_active_changes` | Staged + unstaged diffs (truncated to 3000 chars), modified file list |
| `get_todo_context` | TODO/FIXME/HACK/BUG/NOTE comments in recently modified files |
| `get_build_context` | npm scripts, dependencies, config files (tsconfig, Dockerfile, Makefile…) |

---

## Installation

```bash
# 1. Clone or navigate to the project
cd claude-context-bridge

# 2. Install dependencies
npm install

# 3. Build (TypeScript → JavaScript)
npm run build

# 4. (Optional) Install globally so the binary is on your PATH
npm install -g .
```

---

## Quick test — verify all tools work

Before wiring it into Claude Desktop or Claude Code, confirm everything runs:

```bash
# Test against current directory (walks up to find a .git folder)
node dist/index.js --test

# Test against a specific repo
node dist/index.js --test --repo /path/to/your/project
```

Expected output: JSON from each of the 5 tools printed to stdout.

---

## Running the server

```bash
# Default: stdio transport (Claude Desktop / Claude Code) + SSE on port 3451
node dist/index.js

# Point at a specific repo
node dist/index.js --repo /path/to/myproject

# Change the SSE port
node dist/index.js --port 3452

# SSE-only (no stdio) — useful when you only need the Chrome extension
node dist/index.js --no-stdio

# If installed globally
claude-context-bridge --repo /path/to/myproject
```

---

## Connect to Claude Desktop

Add the server to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "context-bridge": {
      "command": "node",
      "args": [
        "/absolute/path/to/claude-context-bridge/dist/index.js",
        "--repo", "/absolute/path/to/your/repo"
      ]
    }
  }
}
```

If you installed globally (`npm install -g .`):

```json
{
  "mcpServers": {
    "context-bridge": {
      "command": "claude-context-bridge",
      "args": ["--repo", "/absolute/path/to/your/repo"]
    }
  }
}
```

Restart Claude Desktop after saving. The 5 tools will appear in the tool picker.

---

## Connect to Claude Code

```bash
# Add via stdio (recommended — Claude Code manages the process)
claude mcp add context-bridge node /absolute/path/to/claude-context-bridge/dist/index.js -- --repo /path/to/your/repo

# Or if installed globally
claude mcp add context-bridge claude-context-bridge -- --repo /path/to/your/repo

# Verify it was added
claude mcp list
```

The tools are then available in any Claude Code session in your terminal.

---

## Connect via MCP Bridge Chrome Extension

The MCP Bridge extension lets Claude.ai (the web UI) call local MCP servers over SSE.

1. Install the [MCP Bridge Chrome extension](https://chrome.google.com/webstore/detail/mcp-bridge) (search "MCP Bridge" in the Chrome Web Store).

2. Start the bridge server:

   ```bash
   node dist/index.js --repo /path/to/your/repo
   # SSE endpoint starts automatically at http://localhost:3451/sse
   ```

3. In the MCP Bridge extension popup, add a server:
   - **Name:** `context-bridge` (or anything you like)
   - **URL:** `http://localhost:3451/sse`

4. Open [claude.ai](https://claude.ai) — the extension injects the MCP tools into the Claude.ai UI.

5. Health check to confirm the server is running:
   ```
   http://localhost:3451/health
   ```

---

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--repo <path>` | `process.cwd()` (walks up for `.git`) | Explicit repo path |
| `--port <n>` | `3451` | SSE server port |
| `--no-stdio` | off | Disable stdio transport; SSE-only mode |
| `--test` | off | Run all tools, print results, exit |
| `--help` | — | Print usage |

---

## Example prompts to try

Once connected, paste any of these into Claude:

```
Call get_project_context and tell me what I'm working on.
```

```
Use get_recent_claude_sessions to summarize what I was building
in my last few Claude Code sessions.
```

```
Check get_active_changes and review my current diff.
Do you see anything that looks risky?
```

```
Run get_todo_context and prioritize the TODOs in my modified files.
```

```
Combine get_project_context, get_active_changes, and get_build_context
to give me a full situational briefing before we start coding.
```

---

## Project structure

```
claude-context-bridge/
├── src/
│   ├── index.ts              Entry point, CLI flag parsing
│   ├── server.ts             MCP Server factory, tool registration
│   ├── tools/
│   │   ├── git.ts            get_project_context, get_active_changes
│   │   ├── sessions.ts       get_recent_claude_sessions
│   │   └── code.ts           get_todo_context, get_build_context
│   └── transport/
│       ├── stdio.ts          stdio transport (Claude Desktop / Claude Code)
│       └── sse.ts            SSE/HTTP transport (MCP Bridge extension)
├── dist/                     Compiled JavaScript (after npm run build)
├── package.json
├── tsconfig.json
└── README.md
```

---

## Development

```bash
# Run in dev mode without building (uses tsx)
npm run dev -- --test

# Watch-compile
npx tsc --watch

# Run after changes
npm run build && node dist/index.js --test
```
