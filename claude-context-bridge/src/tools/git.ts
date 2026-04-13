import { simpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';

export async function findGitRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function getProjectContext(repoPath?: string): Promise<Record<string, unknown>> {
  const startPath = repoPath ?? process.cwd();
  const gitRoot = await findGitRoot(startPath);

  if (!gitRoot) {
    return { error: `No git repository found starting from: ${startPath}` };
  }

  const git = simpleGit(gitRoot);

  const [branchResult, logResult, statusResult] = await Promise.all([
    git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'unknown'),
    git.log({ maxCount: 5 }).catch(() => ({ all: [] as Array<{ hash: string; message: string; author_name: string; date: string }> })),
    git.status().catch(() => null),
  ]);

  let packageInfo: Record<string, string> | null = null;
  const pkgPath = path.join(gitRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      packageInfo = {
        name: String(pkg.name ?? ''),
        description: String(pkg.description ?? ''),
        version: String(pkg.version ?? ''),
      };
    } catch { /* ignore parse errors */ }
  }

  const log = logResult as { all: Array<{ hash: string; message: string; author_name: string; date: string }> };

  return {
    repo_name: path.basename(gitRoot),
    repo_path: gitRoot,
    branch: typeof branchResult === 'string' ? branchResult.trim() : 'unknown',
    last_commits: log.all.map((c) => ({
      hash: c.hash.substring(0, 7),
      message: c.message,
      author: c.author_name,
      date: c.date,
    })),
    status: statusResult
      ? {
          modified: statusResult.modified,
          staged: statusResult.staged,
          untracked: statusResult.not_added,
        }
      : null,
    package: packageInfo,
  };
}

function redactDiff(diff: string): string {
  const lines = diff.split('\n');
  let inEnvFile = false;
  const result: string[] = [];

  for (const line of lines) {
    // Track file sections — skip .env files entirely
    if (line.startsWith('diff --git ')) {
      inEnvFile = /\.env(\b|$|\.)/.test(line);
      if (inEnvFile) {
        result.push('diff --git [.env file — redacted]');
      } else {
        result.push(line);
      }
      continue;
    }

    if (inEnvFile) continue; // skip all .env diff content

    // Redact sensitive values in added/removed content lines
    if (line.startsWith('+') || line.startsWith('-')) {
      let redacted = line;
      // key=value style (password, secret, api_key, token)
      redacted = redacted.replace(
        /(\b(?:password|secret|api[_-]?key|token)\s*[:=]\s*)(\S+)/gi,
        '$1[REDACTED]'
      );
      // Bearer <token>
      redacted = redacted.replace(/(Bearer\s+)(\S+)/gi, '$1[REDACTED]');
      // sk-... / pk-... style API keys
      redacted = redacted.replace(/\b(sk|pk)-[A-Za-z0-9_-]{10,}/g, '[REDACTED]');
      // PEM private key headers
      redacted = redacted.replace(/-----BEGIN [A-Z ]* PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]');
      result.push(redacted);
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

export async function getActiveChanges(repoPath?: string): Promise<Record<string, unknown>> {
  const startPath = repoPath ?? process.cwd();
  const gitRoot = await findGitRoot(startPath);

  if (!gitRoot) {
    return { error: `No git repository found starting from: ${startPath}` };
  }

  const git = simpleGit(gitRoot);

  const [statusResult, unstagedDiff, stagedDiff] = await Promise.all([
    git.status().catch(() => null),
    git.diff().catch(() => ''),
    git.diff(['--cached']).catch(() => ''),
  ]);

  const combined = [stagedDiff, unstagedDiff].filter(Boolean).join('\n');
  const rawDiff =
    combined.length > 3000
      ? combined.substring(0, 3000) + '\n\n... (truncated — showing first 3000 chars)'
      : combined;

  return {
    modified_files: statusResult?.modified ?? [],
    staged_files: statusResult?.staged ?? [],
    untracked_files: statusResult?.not_added ?? [],
    diff: rawDiff ? redactDiff(rawDiff) : '(no changes)',
  };
}
