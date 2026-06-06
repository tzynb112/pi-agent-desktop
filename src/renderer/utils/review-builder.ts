/**
 * Code review prompt builder for PianoAgent.
 * Extracts git diff, guidelines, and status to build a review prompt.
 */

export interface ReviewContext {
  executeTool: (toolCall: { id: string; name: string; arguments: string }) => Promise<string>;
  rootPath: string | null;
  readFile: (path: string) => Promise<string>;
}

export interface ReviewResult {
  prompt: string;
  hasDiff: boolean;
}

export async function buildReviewPrompt(ctx: ReviewContext): Promise<ReviewResult> {
  const { executeTool, rootPath, readFile } = ctx;

  let diffResult = '';
  try {
    const gitDiff = await executeTool({
      id: 'tool_git_diff',
      name: 'bash',
      arguments: JSON.stringify({ command: 'git diff HEAD' }),
    });
    if (gitDiff && gitDiff.trim() && !gitDiff.includes('fatal:') && !gitDiff.startsWith('Error:')) {
      diffResult = gitDiff;
    } else {
      const lastCommit = await executeTool({
        id: 'tool_last_commit',
        name: 'bash',
        arguments: JSON.stringify({ command: 'git diff HEAD~1 HEAD' }),
      });
      if (lastCommit && lastCommit.trim() && !lastCommit.includes('fatal:') && !lastCommit.startsWith('Error:')) {
        diffResult = lastCommit;
      }
    }
  } catch (e) {
    console.error('[Review] Failed to capture git diff:', e);
  }

  if (!diffResult || diffResult.trim().length === 0 || diffResult.includes('Error:')) {
    diffResult = 'No active git changes or commits detected.';
  }

  let guidelines = '';
  if (rootPath) {
    try {
      const gl = await readFile(rootPath + '\\REVIEW_GUIDELINES.md');
      if (gl) guidelines = gl;
    } catch {}
  }

  let gitStatus = '';
  if (rootPath) {
    try {
      const statusResult = await executeTool({
        id: 'tool_git_status',
        name: 'bash',
        arguments: JSON.stringify({ command: 'git status --short', cwd: rootPath }),
      });
      if (statusResult && !statusResult.startsWith('Error:')) gitStatus = statusResult.trim();
    } catch {}
  }

  const glSection = guidelines ? '\n\nProject Review Guidelines:\n' + guidelines + '\n' : '';
  const stSection = gitStatus ? '\n\nGit Status:\n```\n' + gitStatus + '\n```\n' : '';

  const prompt = [
    'Act as a Principal Staff Software Engineer and Code Review Expert. Perform a comprehensive code audit of the following code diff.',
    '',
    'Group findings by severity:',
    '- Critical: logical bugs, security vulnerabilities, data loss risks, race conditions',
    '- Improvement: style alignment, cleaner logic, performance upgrades, missing error handling',
    '- Nit: naming, comments, minor style, recommended tests',
    '',
    'For each finding, provide: file path, line range, severity, description, and suggested fix.',
    'Maintain an objective, technical, constructive tone.' + glSection + stSection,
    'Code Diff to review:',
    '```diff',
    diffResult,
    '```',
  ].join('\n');

  return { prompt, hasDiff: diffResult.length > 100 };
}
