#!/usr/bin/env node

import { startStdioTransport } from './transport/stdio.js';
import { startSSEServer } from './transport/sse.js';
import { getProjectContext, getActiveChanges } from './tools/git.js';
import { getRecentClaudeSessions } from './tools/sessions.js';
import { getTodoContext, getBuildContext } from './tools/code.js';

interface CliOptions {
  repoPath?: string;
  port: number;
  noStdio: boolean;
  test: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let repoPath: string | undefined;
  let port = 3451;
  let noStdio = false;
  let test = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--repo' || arg === '-r') && args[i + 1]) {
      repoPath = args[++i];
    } else if ((arg === '--port' || arg === '-p') && args[i + 1]) {
      port = parseInt(args[++i], 10);
      if (isNaN(port)) {
        console.error('Invalid port number, using default 3451');
        port = 3451;
      }
    } else if (arg === '--no-stdio') {
      noStdio = true;
    } else if (arg === '--test') {
      test = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return { repoPath, port, noStdio, test };
}

function printHelp(): void {
  console.log(`
claude-context-bridge — Local MCP server for git + Claude Code context

USAGE
  claude-context-bridge [options]

OPTIONS
  --repo, -r <path>   Path to the git repository (default: cwd, walks up to find .git)
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
  claude-context-bridge --port 3452 --no-stdio
  claude-context-bridge --test
`);
}

async function runTests(repoPath?: string): Promise<void> {
  console.log('=== claude-context-bridge: Tool Function Tests ===\n');

  console.log('--- get_project_context ---');
  try {
    const ctx = await getProjectContext(repoPath);
    console.log(JSON.stringify(ctx, null, 2));
  } catch (err) {
    console.error('FAILED:', err);
  }

  console.log('\n--- get_active_changes ---');
  try {
    const changes = await getActiveChanges(repoPath);
    console.log(JSON.stringify(changes, null, 2));
  } catch (err) {
    console.error('FAILED:', err);
  }

  console.log('\n--- get_recent_claude_sessions ---');
  try {
    const sessions = await getRecentClaudeSessions();
    console.log(JSON.stringify(sessions, null, 2));
  } catch (err) {
    console.error('FAILED:', err);
  }

  console.log('\n--- get_todo_context ---');
  try {
    const todos = await getTodoContext(repoPath);
    console.log(JSON.stringify(todos, null, 2));
  } catch (err) {
    console.error('FAILED:', err);
  }

  console.log('\n--- get_build_context ---');
  try {
    const build = await getBuildContext(repoPath);
    console.log(JSON.stringify(build, null, 2));
  } catch (err) {
    console.error('FAILED:', err);
  }

  console.log('\n=== All tools executed ===');
}

async function main(): Promise<void> {
  const { repoPath, port, noStdio, test } = parseArgs();

  if (test) {
    await runTests(repoPath);
    process.exit(0);
  }

  // SSE server always starts (doesn't interfere with stdio)
  startSSEServer(port, { repoPath });

  if (noStdio) {
    console.error('[Bridge] Running in SSE-only mode (--no-stdio). Press Ctrl+C to stop.');
    // Keep the process alive — the HTTP server does this, but be explicit
    process.stdin.resume();
  } else {
    // stdio transport: reads from stdin, writes to stdout (MCP protocol)
    // All logging above uses console.error (stderr) to avoid corrupting the protocol stream
    await startStdioTransport({ repoPath });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
