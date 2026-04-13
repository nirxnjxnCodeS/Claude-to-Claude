import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getProjectContext, getActiveChanges } from './tools/git.js';
import { getRecentClaudeSessions } from './tools/sessions.js';
import { getTodoContext, getBuildContext } from './tools/code.js';
import { getSessionSummary } from './tools/session-summary.js';

/** Mutable reference to the active repo path — updated live in --auto mode. */
export interface RepoRef {
  path: string | undefined;
  mode: 'auto' | 'manual';
}

export interface BridgeOptions {
  repoRef: RepoRef;
}

const TOOLS = [
  {
    name: 'get_project_context',
    description:
      'Get the current git repository context: repo name, branch, last 5 commits, git status, and package.json info. Use this to understand what project the developer is working on.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_recent_claude_sessions',
    description:
      'Read recent Claude Code session history from ~/.claude/projects/. Returns the last 3 sessions with timestamps and first prompts.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_active_changes',
    description:
      'Get staged and unstaged git diffs (truncated to 3000 chars) and the list of modified files.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_todo_context',
    description:
      'Scan recently modified files for TODO, FIXME, HACK, BUG, and NOTE comments. Returns file path, line number, and comment text.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_build_context',
    description:
      'Read package.json scripts, list dependencies, and detect config files (tsconfig, Dockerfile, Makefile, etc.).',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_current_repo',
    description:
      'Returns the currently active repository path and how it was detected (auto-detected from Claude Code sessions, or set manually via --repo flag).',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_session_summary',
    description:
      'Parse the most recent Claude Code session file and return a structured summary: total turns, all user messages, all tool calls made, file paths touched, and the last assistant message.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
] as const;

type ToolName = (typeof TOOLS)[number]['name'];

export function createMCPServer(options: BridgeOptions): Server {
  const server = new Server(
    { name: 'claude-context-bridge', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name as ToolName;
    // Read the current path at call time — picks up live --auto switches
    const repoPath = options.repoRef.path;

    try {
      let result: Record<string, unknown>;

      switch (name) {
        case 'get_project_context':
          result = await getProjectContext(repoPath);
          break;
        case 'get_recent_claude_sessions':
          result = await getRecentClaudeSessions();
          break;
        case 'get_active_changes':
          result = await getActiveChanges(repoPath);
          break;
        case 'get_todo_context':
          result = await getTodoContext(repoPath);
          break;
        case 'get_build_context':
          result = await getBuildContext(repoPath);
          break;
        case 'get_session_summary':
          result = await getSessionSummary();
          break;
        case 'get_current_repo':
          result = {
            repo_path: repoPath ?? null,
            detection: options.repoRef.mode,
            note:
              options.repoRef.mode === 'auto'
                ? repoPath
                  ? 'Auto-detected from most recent Claude Code session'
                  : 'Auto-detection in progress — no session found yet'
                : repoPath
                  ? 'Set via --repo flag'
                  : 'Using process.cwd() (no --repo flag provided)',
          };
          break;
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
            isError: true,
          };
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error executing ${name}: ${String(err)}` }],
        isError: true,
      };
    }
  });

  return server;
}
