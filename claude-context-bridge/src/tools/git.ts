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
  const diff =
    combined.length > 3000
      ? combined.substring(0, 3000) + '\n\n... (truncated — showing first 3000 chars)'
      : combined;

  return {
    modified_files: statusResult?.modified ?? [],
    staged_files: statusResult?.staged ?? [],
    untracked_files: statusResult?.not_added ?? [],
    diff: diff || '(no changes)',
  };
}
