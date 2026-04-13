# claude-context-bridge

[![npm version](https://img.shields.io/npm/v/claude-context-bridge.svg)](https://www.npmjs.com/package/claude-context-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

A local MCP server that exposes your development context — git state, Claude Code session history, active diffs, TODOs, and build setup — as MCP tools. When you open Claude.ai, it already knows what you're working on.

---

## Quick install

```bash
npx claude-context-bridge --auto
```

Or install globally:

```bash
npm install -g claude-context-bridge
claude-context-bridge --auto
```

---

## What it exposes

| Tool | What it returns |
|------|----------------|
| `get_project_context` | Repo name, branch, last 5 commits, git status, package.json info |
| `get_recent_claude_sessions` | Last 3 Claude Code sessions with timestamps and first prompts |
| `get_active_changes` | Staged + unstaged diffs (truncated to 3000 chars), modified file list |
| `get_todo_context` | TODO/FIXME/HACK/BUG/NOTE comments in recently modified files |
| `get_build_context` | npm scripts, dependencies, config files (tsconfig, Dockerfile, Makefile…) |
| `get_current_repo` | Active repo path and how it was detected (auto vs manual) |

---

## How it works

```
  ┌─────────────────┐   ┌─────────────────┐   ┌──────────────────────┐
  │  Claude Desktop │   │  Claude Code    │   │  claude.ai           │
  │  (stdio MCP)    │   │  (stdio MCP)    │   │  (MCP Bridge ext)    │
  └────────┬────────┘   └────────┬────────┘   └──────────┬───────────┘
           │                     │                        │ SSE
           └─────────────────────┼────────────────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │   claude-context-bridge  │
                    │   (this server)          │
                    └──────┬───────────┬───────┘
                           │           │
               ┌───────────▼──┐  ┌────▼────────────┐
               │  git repos   │  │  ~/.claude/      │
               │  on disk     │  │  projects/       │
               └──────────────┘  └─────────────────┘
```

- **stdio transport** — used by Claude Desktop and Claude Code (one persistent connection)
- **SSE transport** — used by the MCP Bridge Chrome extension (HTTP on port 3451)
- **`--auto` mode** — reads `~/.claude/projects/` every 30 s, switches to the repo of the most recently active Claude Code session automatically

---

## Installation

```bash
git clone https://github.com/nirxnjxnCodeS/Claude-to-Claude.git
cd Claude-to-Claude/claude-context-bridge

npm install
npm run build
```

### Verify everything works

```bash
node dist/index.js --test --repo /path/to/any/git/repo
```

---

## Connect to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "context-bridge": {
      "command": "node",
      "args": [
        "/absolute/path/to/claude-context-bridge/dist/index.js",
        "--auto"
      ]
    }
  }
}
```

Restart Claude Desktop — the 6 tools appear in the tool picker.

---

## Connect to Claude Code

```bash
claude mcp add context-bridge node /absolute/path/to/claude-context-bridge/dist/index.js -- --auto

# Verify
claude mcp list
```

---

## Connect via MCP Bridge Chrome Extension

1. Install the **MCP Bridge** extension from the Chrome Web Store.
2. Start the bridge:
   ```bash
   node dist/index.js --auto
   ```
3. In the extension popup, add:
   - **URL:** `http://localhost:3451/sse`
4. Open [claude.ai](https://claude.ai) — tools are injected automatically.
5. Health check: `http://localhost:3451/health`

---

## Auto-start on Mac login

```bash
npm run build
bash scripts/install-autostart.sh
```

The script:
- Detects your `node` binary path automatically
- Writes `~/Library/LaunchAgents/com.claude-context-bridge.plist`
- Loads it with `launchctl` immediately
- Logs to `~/Library/Logs/claude-context-bridge.{out,err}.log`

The bridge will restart automatically if it crashes (KeepAlive: true).

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.claude-context-bridge.plist

# View live logs
tail -f ~/Library/Logs/claude-context-bridge.err.log
```

---

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--repo <path>` | cwd (walks up for `.git`) | Explicit repo path |
| `--auto` | off | Auto-detect active repo from most recent Claude Code session; re-checks every 30 s |
| `--port <n>` | `3451` | SSE server port |
| `--no-stdio` | off | Disable stdio transport; SSE-only mode |
| `--test` | off | Run all tools, print results, exit |
| `--help` | — | Print usage |

> `--auto` and `--repo` are mutually exclusive. `--auto` wins if both are passed.

---

## Example prompts

```
Call get_current_repo to confirm which project I'm in.
```

```
Use get_project_context and tell me what branch I'm on and what changed recently.
```

```
Call get_recent_claude_sessions — what was I building in my last few sessions?
```

```
Check get_active_changes and review my diff. Anything risky?
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
│   ├── index.ts              Entry point, CLI flags, startup logic
│   ├── server.ts             MCP Server factory, tool registration, RepoRef
│   ├── auto-detect.ts        --auto repo detection from ~/.claude/projects/
│   ├── tools/
│   │   ├── git.ts            get_project_context, get_active_changes
│   │   ├── sessions.ts       get_recent_claude_sessions
│   │   └── code.ts           get_todo_context, get_build_context
│   └── transport/
│       ├── stdio.ts          stdio transport
│       └── sse.ts            SSE/HTTP transport (MCP Bridge extension)
├── scripts/
│   └── install-autostart.sh  macOS launchd installer
├── dist/                     Compiled JS (after npm run build)
├── LICENSE
├── package.json
└── README.md
```

---

## Development

```bash
# Dev mode (no build step)
npm run dev -- --test

# Watch mode
npx tsc --watch

# Rebuild and test
npm run build && node dist/index.js --test
```

---

## Contributing

Issues and PRs are welcome at [github.com/nirxnjxnCodeS/Claude-to-Claude](https://github.com/nirxnjxnCodeS/Claude-to-Claude).

- **Bug reports:** include your Node version (`node --version`) and the error from `claude-context-bridge --test`
- **New tools:** add the function in `src/tools/`, register it in `src/server.ts` (TOOLS array + switch case)
- **Transport changes:** keep stdio and SSE symmetric — if a change affects one, check the other
