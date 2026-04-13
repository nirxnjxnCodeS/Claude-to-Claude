import * as fs from 'fs';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import { findGitRoot } from './git.js';

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.rb', '.php', '.swift', '.kt', '.scala',
  '.sh', '.bash', '.zsh', '.fish',
  '.vue', '.svelte', '.astro',
  '.md', '.mdx',
]);

interface TodoMatch {
  file: string;
  line: number;
  type: string;
  comment: string;
}

export async function getTodoContext(repoPath?: string): Promise<Record<string, unknown>> {
  const startPath = repoPath ?? process.cwd();
  const gitRoot = await findGitRoot(startPath);

  if (!gitRoot) {
    return { error: 'No git repository found', todos: [] };
  }

  const git = simpleGit(gitRoot);
  let changedFiles: string[] = [];

  try {
    const status = await git.status();
    const candidates = [
      ...status.modified,
      ...status.staged,
      ...status.not_added,
    ];
    // Deduplicate
    changedFiles = Array.from(new Set(candidates)).filter((f: string) =>
      TEXT_EXTENSIONS.has(path.extname(f))
    );
  } catch {
    return { error: 'Failed to get git status', todos: [] };
  }

  // If nothing is currently changed, look at files touched in recent commits
  if (changedFiles.length === 0) {
    try {
      const diffResult = await git.diff(['HEAD~5..HEAD', '--name-only']);
      const recentFiles = diffResult.trim().split('\n').filter(Boolean);
      changedFiles = recentFiles.filter((f) => TEXT_EXTENSIONS.has(path.extname(f)));
    } catch { /* ignore */ }
  }

  const todos: TodoMatch[] = [];

  for (const relFile of changedFiles.slice(0, 25)) {
    const fullPath = path.join(gitRoot, relFile);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((lineContent, idx) => {
        const regex = /\b(TODO|FIXME|HACK|XXX|BUG|NOTE)\b[:\s]*(.*)/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(lineContent)) !== null) {
          todos.push({
            file: relFile,
            line: idx + 1,
            type: match[1].toUpperCase(),
            comment: match[2].trim().substring(0, 150),
          });
        }
      });
    } catch { /* skip unreadable files */ }
  }

  return {
    todos,
    scanned_files: changedFiles.length,
    total_todos: todos.length,
  };
}

const KNOWN_CONFIG_FILES = [
  'tsconfig.json',
  'tsconfig.base.json',
  'jsconfig.json',
  '.env.example',
  '.env.sample',
  '.env.template',
  'Makefile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Dockerfile',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.prettierrc',
  '.prettierrc.json',
  'jest.config.js',
  'jest.config.ts',
  'vitest.config.ts',
  'vitest.config.js',
  'vite.config.ts',
  'vite.config.js',
  'webpack.config.js',
  'rollup.config.js',
  'next.config.js',
  'next.config.ts',
  'nuxt.config.ts',
  'svelte.config.js',
  'astro.config.mjs',
  '.github/workflows',
  'cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
] as const;

export async function getBuildContext(repoPath?: string): Promise<Record<string, unknown>> {
  const startPath = repoPath ?? process.cwd();
  const gitRoot = await findGitRoot(startPath);

  if (!gitRoot) {
    return { error: 'No git repository found' };
  }

  let scripts: Record<string, string> = {};
  let dependencies: string[] = [];
  let devDependencies: string[] = [];

  const pkgPath = path.join(gitRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      scripts = pkg.scripts ?? {};
      dependencies = Object.keys(pkg.dependencies ?? {});
      devDependencies = Object.keys(pkg.devDependencies ?? {});
    } catch { /* ignore */ }
  }

  const presentConfigs: string[] = [];
  for (const configFile of KNOWN_CONFIG_FILES) {
    if (fs.existsSync(path.join(gitRoot, configFile))) {
      presentConfigs.push(configFile);
    }
  }

  let makeTargets: string[] = [];
  const makefilePath = path.join(gitRoot, 'Makefile');
  if (fs.existsSync(makefilePath)) {
    try {
      const makeContent = fs.readFileSync(makefilePath, 'utf-8');
      const targetMatches = makeContent.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/gm) ?? [];
      makeTargets = targetMatches.map((t) => t.replace(':', ''));
    } catch { /* ignore */ }
  }

  return {
    npm_scripts: scripts,
    dependencies: {
      count: dependencies.length,
      list: dependencies.slice(0, 30),
    },
    dev_dependencies: {
      count: devDependencies.length,
      list: devDependencies.slice(0, 20),
    },
    config_files_present: presentConfigs,
    make_targets: makeTargets,
  };
}
