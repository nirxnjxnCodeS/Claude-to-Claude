import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RepoRef } from './server.js';

/**
 * Decode a Claude project directory name back to the real filesystem path.
 *
 * Claude encodes the project path by replacing every '/' with '-', so the
 * path /Users/alice/my-app becomes -Users-alice-my-app. The tricky case is
 * that literal '-' in directory names is NOT escaped, creating ambiguity.
 *
 * We resolve ambiguity with a greedy filesystem walk: at each position we
 * try to match the longest sequence of dash-separated segments that
 * corresponds to a real directory on disk.
 */
async function decodeDirToPath(encoded: string): Promise<string | null> {
  // Strip the leading '-' (represents the root '/') and split on '-'
  const segments = encoded.replace(/^-/, '').split('-').filter(Boolean);

  let currentPath = '/';
  let idx = 0;

  while (idx < segments.length) {
    let matched = false;
    // Try longest match first so 'Claude-to-Claude' wins over 'Claude'
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
      } catch { /* path doesn't exist — try shorter */ }
    }
    // No segment matched — stop walking
    if (!matched) break;
  }

  return currentPath === '/' ? null : currentPath;
}

async function findGitRoot(startPath: string): Promise<string | null> {
  let current = startPath;
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function detectActiveRepo(): Promise<string | undefined> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return undefined;

  let latestMtime = 0;
  let latestDirName: string | undefined;

  try {
    const dirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of dirs) {
      const dirPath = path.join(projectsDir, dir.name);
      try {
        const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
        for (const f of files) {
          const stat = fs.statSync(path.join(dirPath, f));
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            latestDirName = dir.name;
          }
        }
      } catch { /* skip unreadable dirs */ }
    }
  } catch {
    return undefined;
  }

  if (!latestDirName) return undefined;

  const decoded = await decodeDirToPath(latestDirName);
  if (!decoded) return undefined;

  // Prefer the git root over the raw decoded path
  const gitRoot = await findGitRoot(decoded);
  return gitRoot ?? decoded;
}

/**
 * Start the auto-detection loop. Checks every `intervalMs` milliseconds
 * (default 30 s) for a new active repo based on the most recently modified
 * Claude Code session. Updates `repoRef.path` in-place when it switches.
 */
export function startAutoDetect(repoRef: RepoRef, intervalMs = 30_000): void {
  const tick = async (): Promise<void> => {
    try {
      const detected = await detectActiveRepo();
      if (detected && detected !== repoRef.path) {
        console.error(`[Bridge] Switched repo to: ${detected}`);
        repoRef.path = detected;
      }
    } catch (err) {
      console.error('[AutoDetect] Error during detection:', err);
    }
  };

  void tick(); // run immediately on startup
  setInterval(() => void tick(), intervalMs);
}
