#!/usr/bin/env node

import { type RepoRef, createMCPServer } from './server.js';
import { startStdioTransport } from './transport/stdio.js';
import { startSSEServer } from './transport/sse.js';
import { startAutoDetect } from './auto-detect.js';
import { getProjectContext, getActiveChanges } from './tools/git.js';
import { getRecentClaudeSessions } from './tools/sessions.js';
import { getTodoContext, getBuildContext } from './tools/code.js';

interface CliOptions {
  repoPath?: string;
  port: number;
  noStdio: boolean;
  auto: boolean;
  test: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let repoPath: string | undefined;
  let port = 3451;
  let noStdio = false;
  let auto = false;
  let test = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--repo' || arg === '-r') && args[i + 1]) {
      repoPath = args[++i];
    } else if ((arg === '--port' || arg === '-p') && args[i + 1]) {
      port = parseInt(args[++i], 10);
      if (isNaN(port)) {
        console.error('Invalid port, using default 3451');
        port = 3451;
      }
    } else if (arg === '--no-stdio') {
      noStdio = true;
    } else if (arg === '--auto') {
      auto = true;
    } else if (arg === '--test') {
      test = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return { repoPath, port, noStdio, auto, test };
}

function printHelp(): void {
  console.log(`
claude-context-bridge — Local MCP server for git + Claude Code context

USAGE
  claude-context-bridge [options]

OPTIONS
  --repo, -r <path>   Explicit git repository path (default: cwd, walks up for .git)
  --auto              Auto-detect active repo from most recent Claude Code session;
                      re-checks every 30 s and switches if a newer session appears
  --port, -p <port>   SSE server port (default: 3451)
  --no-stdio          Disable stdio transport; run SSE-only
  --test              Run all tool functions and print output, then exit
  --help, -h          Show this help

TRANSPORTS
  stdio               Default — for Claude Desktop and Claude Code (claude mcp add)
  SSE on <port>       Always started — for MCP Bridge Chrome extension

EXAMPLES
  claude-context-bridge
  claude-context-bridge --repo /path/to/myproject
  claude-context-bridge --auto
  claude-context-bridge --auto --port 3452 --no-stdio
  claude-context-bridge --test
`);
}

async function runTests(repoPath?: string): Promise<void> {
  console.log('=== claude-context-bridge: Tool Function Tests ===\n');

  for (const [label, fn] of [
    ['get_project_context', () => getProjectContext(repoPath)],
    ['get_active_changes', () => getActiveChanges(repoPath)],
    ['get_recent_claude_sessions', () => getRecentClaudeSessions()],
    ['get_todo_context', () => getTodoContext(repoPath)],
    ['get_build_context', () => getBuildContext(repoPath)],
  ] as const) {
    console.log(`\n--- ${label} ---`);
    try {
      console.log(JSON.stringify(await fn(), null, 2));
    } catch (err) {
      console.error('FAILED:', err);
    }
  }

  console.log('\n=== All tools executed ===');
}

async function main(): Promise<void> {
  const { repoPath, port, noStdio, auto, test } = parseArgs();

  if (test) {
    await runTests(repoPath);
    process.exit(0);
  }

  // Build a mutable ref — tools read .path at call time so --auto switches
  // are picked up on every invocation without restarting the server
  const repoRef: RepoRef = {
    path: auto ? undefined : repoPath,
    mode: auto ? 'auto' : 'manual',
  };

  if (auto) {
    startAutoDetect(repoRef); // sets repoRef.path every 30 s
    console.error('[Bridge] Auto-detect mode: watching ~/.claude/projects/');
  }

  // Single factory — both transports share the same repoRef, so they always
  // see the same current path regardless of which transport the client uses
  const serverFactory = () => createMCPServer({ repoRef });

  // SSE always starts (different I/O from stdio — no conflict)
  startSSEServer(port, serverFactory);

  if (noStdio) {
    console.error('[Bridge] SSE-only mode (--no-stdio). Press Ctrl+C to stop.');
    process.stdin.resume();
  } else {
    // stdio reads MCP from stdin / writes to stdout.
    // All logging above goes to stderr to avoid corrupting the protocol stream.
    await startStdioTransport({ repoRef });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
