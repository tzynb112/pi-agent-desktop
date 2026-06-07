const DOWNLOAD_COMMAND_PATTERN =
  /(?:\bgit\s+clone\b|\bgh\s+repo\s+clone\b|\bcurl\b.*\s-(?:o|O)\b|\bwget\b|\bInvoke-WebRequest\b|\biwr\b|\bStart-BitsTransfer\b|\bnpm\s+install\b|\bpnpm\s+(?:install|add)\b|\byarn\s+(?:install|add)\b)/i;

const GIT_CLONE_PATTERN = /\bgit\s+clone\b/i;
const GH_CLONE_PATTERN = /\bgh\s+repo\s+clone\b/i;

export function isDownloadCommand(command: string): boolean {
  return DOWNLOAD_COMMAND_PATTERN.test(command);
}

function describeDownloadAction(command: string): string {
  if (GIT_CLONE_PATTERN.test(command) || GH_CLONE_PATTERN.test(command)) return 'clone';
  return 'download/install';
}

export function buildDownloadSuccessMessage(command: string, combinedOutput: string): string {
  const action = describeDownloadAction(command);
  const baseMessage = combinedOutput === '(no output)'
    ? `Command executed successfully. The ${action} operation completed and the files should now be available locally. No console output is expected for this command.`
    : `Command executed successfully. Output: ${combinedOutput}. The ${action} operation completed successfully.`;

  return `${baseMessage} IMPORTANT: This command SUCCEEDED. Do NOT retry it. Summarize what was downloaded and continue with the next step.`;
}
