import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface RawEntry {
  type?: string;
  message?: {
    content?: unknown;
  };
}

interface SessionInfo {
  filename: string;
  project: string;
  timestamp: string;
  first_prompt: string;
}

function extractFirstPrompt(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as RawEntry;
      if (entry.type === 'user' && entry.message?.content) {
        const msgContent = entry.message.content;
        let text = '';
        if (Array.isArray(msgContent)) {
          const textBlock = (msgContent as Array<{ type?: string; text?: string }>).find(
            (c) => c.type === 'text'
          );
          text = textBlock?.text ?? '';
        } else if (typeof msgContent === 'string') {
          text = msgContent;
        }
        if (text.trim()) {
          return text.substring(0, 200);
        }
      }
    } catch { /* skip malformed JSON lines */ }
  }

  return '(no text prompt found)';
}

function decodeDirName(dirName: string): string {
  // Claude encodes project paths: slashes become --, spaces become -, etc.
  // Attempt a best-effort decode for display
  try {
    return decodeURIComponent(dirName.replace(/--/g, '%2F').replace(/-([a-z])/g, '-$1'));
  } catch {
    return dirName;
  }
}

export async function getRecentClaudeSessions(): Promise<Record<string, unknown>> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');

  if (!fs.existsSync(projectsDir)) {
    return {
      error: `Claude projects directory not found at ${projectsDir}`,
      sessions: [],
    };
  }

  const allFiles: Array<{ filePath: string; mtime: number; projectName: string }> = [];

  try {
    const projectDirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, fullPath: path.join(projectsDir, d.name) }));

    for (const { name: projectName, fullPath: projectDir } of projectDirs) {
      try {
        const entries = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
        for (const f of entries) {
          const filePath = path.join(projectDir, f);
          const stat = fs.statSync(filePath);
          allFiles.push({ filePath, mtime: stat.mtimeMs, projectName });
        }
      } catch { /* skip unreadable directories */ }
    }
  } catch (err) {
    return {
      error: `Failed to read projects directory: ${String(err)}`,
      sessions: [],
    };
  }

  // Most recently modified first
  allFiles.sort((a, b) => b.mtime - a.mtime);

  const sessions: SessionInfo[] = [];

  for (const { filePath, mtime, projectName } of allFiles.slice(0, 3)) {
    try {
      const firstPrompt = extractFirstPrompt(filePath);
      sessions.push({
        filename: path.basename(filePath),
        project: decodeDirName(projectName),
        timestamp: new Date(mtime).toISOString(),
        first_prompt: firstPrompt,
      });
    } catch { /* skip unreadable session files */ }
  }

  return {
    sessions,
    total_session_files: allFiles.length,
  };
}
