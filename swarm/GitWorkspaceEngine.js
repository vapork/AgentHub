const { execSync, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Extensions considered valid for code/config files that agenthub can write
const VALID_CODE_EXTENSIONS = /\.(jsx?|tsx?|mjs|cjs|css|scss|sass|less|json|jsonc|ya?ml|toml|md|mdx|py|rb|java|kt|swift|go|rs|sh|bash|zsh|ps1|env|sql|html?|xml|svg|graphql|prisma|proto|tf|hcl|lock|ini|cfg|conf|txt)$/i;

class GitWorkspaceEngine {
  constructor(options = {}) {
    this.workspaceDir = options.workspaceDir || process.env.AGENTHUB_WORKSPACE || 'C:/Users/karan/OneDrive/Desktop/Project/SIMS';
    this.aiderPath = options.aiderPath || 'aider';
    this.litellmBase = options.litellmBase || 'http://127.0.0.1:4000/v1';
    this.litellmModel = options.litellmModel || 'openai/swarm-master';
  }

  setWorkspace(dir) {
    if (!dir || !fs.existsSync(dir)) {
      throw new Error(`Workspace directory does not exist: ${dir}`);
    }
    // Verify it is a git repo
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      throw new Error(`Directory is not a valid git repository: ${dir}`);
    }
    this.workspaceDir = path.resolve(dir);
    return { success: true, workspaceDir: this.workspaceDir };
  }

  getWorkspaceInfo() {
    try {
      const isGit = fs.existsSync(path.join(this.workspaceDir, '.git'));
      if (!isGit) {
        return {
          workspaceDir: this.workspaceDir,
          isGit: false,
          branch: null,
          clean: true,
          latestCommit: null,
        };
      }
      const branch = execSync('git branch --show-current', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
      const status = execSync('git status --porcelain', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
      const latestCommit = execSync('git log -1 --oneline', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();

      return {
        workspaceDir: this.workspaceDir,
        isGit: true,
        branch,
        clean: status.length === 0,
        uncommittedFiles: status ? status.split('\n').length : 0,
        latestCommit,
      };
    } catch (err) {
      return {
        workspaceDir: this.workspaceDir,
        isGit: false,
        error: err.message,
      };
    }
  }

  /**
   * Parses code blocks with file path hints from text/markdown.
   * Recognizes:
   *   // src/... or // frontend/src/...
   *   File: path/to/file
   *   ```tsx // src/components/AppDrawer.tsx
   */
  parseCodeFiles(text) {
    if (!text || typeof text !== 'string') return [];
    const files = [];
    const codeBlockRegex = /```(?:[a-zA-Z0-9_\-\.\+]+)?(?:\s+([^\n\r]+))?\r?\n([\s\S]*?)```/g;
    let match;

    // Returns true only if the string looks like a real file path
    const isValidFilePath = (s) => {
      if (!s) return false;
      const clean = s.replace(/^(\/\/|#|\/\*|\*)\s*/, '').trim();
      if (clean.includes(':')) return false;           // rules out YAML keys, URLs
      if (!/[/\\]/.test(clean)) return false;         // must have a path separator
      if (/^\d+\.\d+/.test(clean)) return false;      // rules out semver like 3.0.3
      if (/\s/.test(clean)) return false;             // no spaces in file paths
      if (!VALID_CODE_EXTENSIONS.test(clean)) return false; // must end with real extension
      return true;
    };

    while ((match = codeBlockRegex.exec(text)) !== null) {
      const headerHint = (match[1] || '').trim();
      const code = match[2];

      let targetPath = null;

      // 1. Check header hint for path
      if (headerHint && isValidFilePath(headerHint)) {
        targetPath = headerHint.replace(/^(\/\/|#|\/\*|\*)\s*/, '').trim();
      }

      // 2. Check first 5 lines of code for a path annotation comment
      if (!targetPath) {
        const lines = code.slice(0, 400).split(/\r?\n/);
        for (let i = 0; i < Math.min(lines.length, 5); i++) {
          const line = lines[i].trim();
          const commentPathMatch = line.match(/^(?:\/\/\s*|#\s*|\/\*\s*|<!--\s*)(.+)/);
          if (commentPathMatch && isValidFilePath(commentPathMatch[1].trim())) {
            targetPath = commentPathMatch[1].trim();
            break;
          }
        }
      }

      if (targetPath) {
        // Normalize path: strip leading slashes, use forward slashes
        targetPath = targetPath.replace(/^[\\\/]+/, '').replace(/\\/g, '/');
        // If workspace has 'frontend/src' and path starts with 'src/', auto-prepend 'frontend/'
        if (targetPath.startsWith('src/') && fs.existsSync(path.join(this.workspaceDir, 'frontend', 'src'))) {
          targetPath = 'frontend/' + targetPath;
        }

        files.push({
          relPath: targetPath,
          fullPath: path.join(this.workspaceDir, targetPath),
          content: code,
        });
      }
    }

    return files;
  }

  /**
   * Applies task deliverables directly to the workspace filesystem and commits them.
   */
  applyTaskChanges(task, options = {}) {
    if (!task) throw new Error('Task object is required');
    const deliverableText = task.deliverable || task.architectGuidance || '';
    if (!deliverableText) {
      throw new Error(`Task "${task.title}" has no deliverable content to apply.`);
    }

    const parsedFiles = this.parseCodeFiles(deliverableText);
    const writtenFiles = [];

    // Write all parsed files
    for (const file of parsedFiles) {
      const dir = path.dirname(file.fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(file.fullPath, file.content, 'utf8');
      writtenFiles.push(file.relPath);
    }

    // If no code files were parsed, save deliverable as a markdown spec/doc
    const noCodeFilesFound = writtenFiles.length === 0;
    if (noCodeFilesFound) {
      const docPath = `docs/agenthub/${task.id}-${task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
      const fullDocPath = path.join(this.workspaceDir, docPath);
      fs.mkdirSync(path.dirname(fullDocPath), { recursive: true });
      fs.writeFileSync(fullDocPath, deliverableText, 'utf8');
      writtenFiles.push(docPath);
    }

    // Git add (using execFileSync + array args — safe for Windows paths with spaces)
    try {
      for (const f of writtenFiles) {
        execFileSync('git', ['add', '--', f], { cwd: this.workspaceDir, encoding: 'utf8' });
      }

      const commitMsg = `feat(agenthub): [${task.id}] ${task.title}`;
      execFileSync('git', ['commit', '-m', commitMsg], { cwd: this.workspaceDir, encoding: 'utf8' });

      const hash = execSync('git rev-parse HEAD', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
      const shortHash = hash.slice(0, 7);
      const stat = execSync('git show --stat --oneline HEAD', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
      const diff = execSync('git diff HEAD~1 HEAD', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();

      const gitCommit = {
        hash,
        shortHash,
        message: commitMsg,
        files: writtenFiles,
        stat,
        diff,
        timestamp: Date.now(),
        noCodeFilesFound,
      };

      task.gitCommit = gitCommit;
      return {
        success: true,
        gitCommit,
        writtenFiles,
        noCodeFilesFound,
      };
    } catch (gitErr) {
      // Check if working tree is already clean (nothing to commit)
      const status = execSync('git status --porcelain', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
      if (!status) {
        const latestHash = execSync('git rev-parse HEAD', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
        const gitCommit = {
          hash: latestHash,
          shortHash: latestHash.slice(0, 7),
          message: `Already up to date with task ${task.id}`,
          files: writtenFiles,
          stat: 'Files matched workspace state',
          diff: '',
          timestamp: Date.now(),
          noCodeFilesFound,
        };
        task.gitCommit = gitCommit;
        return { success: true, gitCommit, writtenFiles, unchanged: true, noCodeFilesFound };
      }
      throw new Error(`Git commit failed: ${gitErr.message}`);
    }
  }

  /**
   * Invokes aider CLI in batch mode against the workspace repository.
   */
  async runAider(task, options = {}) {
    if (!task) throw new Error('Task object is required');

    return new Promise((resolve, reject) => {
      const prompt = `Implement task [${task.id}] "${task.title}":
Description: ${task.description}
Acceptance Criteria: ${task.acceptanceCriteria}
${task.architectGuidance ? 'Architecture Guidance:\n' + task.architectGuidance : ''}
${task.deliverable ? 'Deliverable Blueprint:\n' + task.deliverable : ''}
Please make all necessary code changes, verify imports, and commit.`;

      const args = [
        '--yes-always',
        '--no-gui',
        '--openai-api-base', this.litellmBase,
        '--openai-api-key', 'not-needed',
        '--model', this.litellmModel,
        '-m', prompt,
      ];

      if (options.files && Array.isArray(options.files)) {
        options.files.forEach((f) => args.push('--file', f));
      }

      console.log(`[GitWorkspaceEngine] Spawning aider in ${this.workspaceDir}...`);
      const child = spawn(this.aiderPath, args, {
        cwd: this.workspaceDir,
        shell: true,
        env: { ...process.env, PYTHONUTF8: '1' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        try {
          const hash = execSync('git rev-parse HEAD', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
          const shortHash = hash.slice(0, 7);
          const stat = execSync('git show --stat --oneline HEAD', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
          const diff = execSync('git diff HEAD~1 HEAD', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();

          const gitCommit = {
            hash,
            shortHash,
            message: `aider: [${task.id}] ${task.title}`,
            stat,
            diff,
            timestamp: Date.now(),
            aiderLog: stdout.slice(-1500),
          };

          task.gitCommit = gitCommit;
          resolve({ success: true, gitCommit, output: stdout });
        } catch (err) {
          resolve({ success: code === 0, error: err.message, output: stdout, stderr });
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to execute aider: ${err.message}`));
      });
    });
  }

  /**
   * Reverts a commit cleanly using git revert.
   */
  revertCommit(commitHash) {
    if (!commitHash) throw new Error('Commit hash is required to revert.');
    try {
      execSync(`git revert --no-edit ${commitHash}`, { cwd: this.workspaceDir, encoding: 'utf8' });
      const newHash = execSync('git rev-parse HEAD', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
      const stat = execSync('git show --stat --oneline HEAD', { cwd: this.workspaceDir, encoding: 'utf8' }).trim();

      return {
        success: true,
        revertCommitHash: newHash,
        shortHash: newHash.slice(0, 7),
        revertedCommit: commitHash,
        stat,
      };
    } catch (err) {
      throw new Error(`Git revert failed: ${err.message}`);
    }
  }

  /**
   * Returns the unified git diff and stat for a commit.
   */
  getCommitDiff(commitHash) {
    if (!commitHash) throw new Error('Commit hash is required.');
    try {
      const show = execSync(`git show --stat --patch ${commitHash}`, { cwd: this.workspaceDir, encoding: 'utf8' });
      const stat = execSync(`git show --stat --oneline ${commitHash}`, { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
      const log = execSync(`git log -1 --pretty=format:"%h|%an|%ad|%s" ${commitHash}`, { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
      const parts = log.split('|');

      return {
        success: true,
        commitHash,
        shortHash: parts[0] || commitHash.slice(0, 7),
        author: parts[1] || 'AgentHub',
        date: parts[2] || '',
        message: parts[3] || '',
        stat,
        diff: show,
      };
    } catch (err) {
      throw new Error(`Failed to get diff for ${commitHash}: ${err.message}`);
    }
  }

  /**
   * Returns list of recent git commits in the workspace.
   */
  getRecentCommits(limit = 10) {
    try {
      const raw = execSync(`git log -n ${limit} --oneline`, { cwd: this.workspaceDir, encoding: 'utf8' }).trim();
      return raw.split('\n').filter(Boolean).map((line) => {
        const spaceIdx = line.indexOf(' ');
        return {
          hash: line.slice(0, spaceIdx),
          subject: line.slice(spaceIdx + 1),
        };
      });
    } catch (err) {
      return [];
    }
  }
}

module.exports = { GitWorkspaceEngine };
