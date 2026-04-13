import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface RawMessage {
  role?: string;
  content?: unknown;
}

interface RawEntry {
  type?: string;
  timestamp?: string;
  message?: RawMessage;
}

/** Extract all text blocks from a message content value. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as ContentBlock[])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join(' ')
      .trim();
  }
  return '';
}

/** Extract tool_use blocks from a message content value. */
function extractToolUses(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return (content as ContentBlock[]).filter((b) => b.type === 'tool_use' && b.name);
}

/** Build a short human-readable label for a tool call. */
function summariseTool(block: ContentBlock): string {
  const name = block.name ?? 'unknown';
  const input = block.input ?? {};

  if (typeof input['file_path'] === 'string') {
    return `${name}(${input['file_path'] as string})`;
  }
  if (typeof input['path'] === 'string') {
    return `${name}(${input['path'] as string})`;
  }
  if (typeof input['pattern'] === 'string') {
    const ctx = typeof input['path'] === 'string' ? ` in ${input['path'] as string}` : '';
    return `${name}(${input['pattern'] as string}${ctx})`;
  }
  if (typeof input['command'] === 'string') {
    const cmd = (input['command'] as string).substring(0, 60);
    return `${name}(${cmd}${input['command'].length > 60 ? '…' : ''})`;
  }

  const raw = JSON.stringify(input);
  return `${name}(${raw.substring(0, 60)}${raw.length > 60 ? '…' : ''})`;
}

/** Tools whose inputs reference file paths we should collect. */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'NotebookEdit']);

/** Extract a file path from a tool input, if one is present. */
function extractFilePath(name: string, input: Record<string, unknown>): string | null {
  if (!FILE_TOOLS.has(name)) return null;
  if (typeof input['file_path'] === 'string') return input['file_path'] as string;
  if (typeof input['path'] === 'string') return input['path'] as string;
  if (typeof input['pattern'] === 'string') return input['pattern'] as string;
  return null;
}

/** Find the most recently modified .jsonl file across all Claude project dirs. */
function findLatestSessionFile(): { filePath: string; projectDirName: string } | null {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  let latestMtime = 0;
  let result: { filePath: string; projectDirName: string } | null = null;

  try {
    const dirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of dirs) {
      const dirPath = path.join(projectsDir, dir.name);
      try {
        const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
        for (const f of files) {
          const filePath = path.join(dirPath, f);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            result = { filePath, projectDirName: dir.name };
          }
        }
      } catch { /* skip unreadable dirs */ }
    }
  } catch {
    return null;
  }

  return result;
}

/** Best-effort decode of a Claude project dir name back to a filesystem path. */
function decodeDirName(encoded: string): string {
  const segments = encoded.replace(/^-/, '').split('-').filter(Boolean);
  let currentPath = '/';
  let idx = 0;

  while (idx < segments.length) {
    let matched = false;
    for (let end = segments.length; end > idx; end--) {
      const name = segments.slice(idx, end).join('-');
      const candidate = path.join(currentPath, name);
      try {
        if (fs.statSync(candidate).isDirectory()) {
          currentPath = candidate;
          idx = end;
          matched = true;
          break;
        }
      } catch { /* try shorter */ }
    }
    if (!matched) break;
  }

  return currentPath === '/' ? encoded : currentPath;
}

export interface SessionSummary extends Record<string, unknown> {
  session_file: string;
  project: string;
  total_turns: number;
  user_messages: string[];
  tools_used: string[];
  files_touched: string[];
  last_assistant_message: string;
  started_at: string | null;
  last_active: string | null;
}

export async function getSessionSummary(): Promise<Record<string, unknown>> {
  const found = findLatestSessionFile();
  if (!found) {
    return { error: 'No Claude Code session files found in ~/.claude/projects/' };
  }

  const { filePath, projectDirName } = found;
  const stat = fs.statSync(filePath);

  let rawLines: string[];
  try {
    rawLines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
  } catch (err) {
    return { error: `Failed to read session file: ${String(err)}` };
  }

  const userMessages: string[] = [];
  const toolsUsed: string[] = [];
  const filesTouched = new Set<string>();
  let lastAssistantMessage = '';
  let startedAt: string | null = null;
  let lastActive: string | null = null;
  let totalTurns = 0;

  for (const line of rawLines) {
    let entry: RawEntry;
    try {
      entry = JSON.parse(line) as RawEntry;
    } catch {
      continue;
    }

    // Track timestamps
    if (entry.timestamp) {
      if (!startedAt) startedAt = entry.timestamp;
      lastActive = entry.timestamp;
    }

    const msgContent = entry.message?.content;
    const role = entry.type ?? entry.message?.role;

    if (role === 'user') {
      totalTurns += 1;
      const text = extractText(msgContent);
      if (text) {
        userMessages.push(text.substring(0, 100) + (text.length > 100 ? '…' : ''));
      }
    } else if (role === 'assistant') {
      totalTurns += 1;

      // Collect tool calls
      for (const block of extractToolUses(msgContent)) {
        toolsUsed.push(summariseTool(block));
        const fp = extractFilePath(block.name ?? '', block.input ?? {});
        if (fp) filesTouched.add(fp);
      }

      // Track the last meaningful assistant text
      const text = extractText(msgContent);
      if (text) {
        lastAssistantMessage = text.substring(0, 300) + (text.length > 300 ? '…' : '');
      }
    }
  }

  // Fall back to file mtime if no timestamps in entries
  if (!startedAt) startedAt = null;
  if (!lastActive) lastActive = new Date(stat.mtimeMs).toISOString();

  const summary: SessionSummary = {
    session_file: path.basename(filePath),
    project: decodeDirName(projectDirName),
    total_turns: totalTurns,
    user_messages: userMessages,
    tools_used: toolsUsed,
    files_touched: Array.from(filesTouched),
    last_assistant_message: lastAssistantMessage || '(none found)',
    started_at: startedAt,
    last_active: lastActive,
  };

  return summary;
}
