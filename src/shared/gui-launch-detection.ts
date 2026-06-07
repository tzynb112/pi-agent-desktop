const GUI_LAUNCH_COMMAND_PATTERN = /Start-Process|Invoke-Item|\bstart\s|xdg-open|\bopen\s|cmd\s*\/c\s*start/i;
const GUI_LAUNCH_QUOTED_TARGET_PATTERN =
  /["']([^"']+\.(?:html?|htm|pdf|png|jpg|jpeg|svg|mp4|mp3|wav|txt|md|docx?|xlsx?|pptx?))["']/i;
const GUI_LAUNCH_UNQUOTED_TARGET_PATTERN =
  /([A-Za-z]:\\[^\s"']+?\.(?:html?|htm|pdf|png|jpg|jpeg|svg|mp4|mp3|wav|txt|md|docx?|xlsx?|pptx?))/i;

export interface GuiLaunchTracker {
  pendingTargets: Set<string>;
  openedTargets: Set<string>;
}

export interface GuiLaunchReservation {
  target: string;
  normalizedTarget: string;
  isDuplicate: boolean;
  alreadyOpened: boolean;
  wasReserved: boolean;
}

export function createGuiLaunchTracker(): GuiLaunchTracker {
  return {
    pendingTargets: new Set<string>(),
    openedTargets: new Set<string>(),
  };
}

export function isGuiLaunchCommand(command: string): boolean {
  return GUI_LAUNCH_COMMAND_PATTERN.test(command);
}

export function extractGuiLaunchTarget(command: string): string | null {
  const quotedMatch = command.match(GUI_LAUNCH_QUOTED_TARGET_PATTERN);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const unquotedMatch = command.match(GUI_LAUNCH_UNQUOTED_TARGET_PATTERN);
  return unquotedMatch?.[1] || null;
}

export function normalizeGuiLaunchTarget(target: string): string {
  return target.trim().toLowerCase().replace(/\\/g, '/');
}

export function reserveGuiLaunchTarget(
  tracker: GuiLaunchTracker,
  command: string,
): GuiLaunchReservation | null {
  if (!isGuiLaunchCommand(command)) return null;

  const target = extractGuiLaunchTarget(command);
  if (!target) return null;

  const normalizedTarget = normalizeGuiLaunchTarget(target);
  const alreadyOpened = tracker.openedTargets.has(normalizedTarget);
  const isPending = tracker.pendingTargets.has(normalizedTarget);
  if (alreadyOpened || isPending) {
    return {
      target,
      normalizedTarget,
      isDuplicate: true,
      alreadyOpened,
      wasReserved: false,
    };
  }

  tracker.pendingTargets.add(normalizedTarget);
  return {
    target,
    normalizedTarget,
    isDuplicate: false,
    alreadyOpened: false,
    wasReserved: true,
  };
}

export function markGuiLaunchSucceeded(tracker: GuiLaunchTracker, normalizedTarget: string): void {
  tracker.pendingTargets.delete(normalizedTarget);
  tracker.openedTargets.add(normalizedTarget);
}

export function markGuiLaunchFailed(tracker: GuiLaunchTracker, normalizedTarget: string): void {
  tracker.pendingTargets.delete(normalizedTarget);
}

export function buildGuiLaunchSuccessMessage(combinedOutput: string): string {
  const guiMessage = combinedOutput === '(no output)'
    ? 'Command executed successfully. The GUI process (browser or application) has been launched and should be visible on the user\'s desktop. No console output is expected for GUI commands.'
    : `Command executed successfully. Output: ${combinedOutput}. The GUI process is running and visible on the user's desktop.`;

  return `${guiMessage} IMPORTANT: This command SUCCEEDED. The file/application IS open. Do NOT say it might not have opened. Do NOT suggest the user open it manually. Do NOT retry this command.`;
}

export function buildDuplicateGuiLaunchMessage(target: string): string {
  return `The file/application '${normalizeGuiLaunchTarget(target)}' is already open. Do NOT retry this command. Do NOT suggest opening it again. Tell the user the file is open and stop.`;
}
