import type { XmlToolCall } from './tool-protocol';
import { truncateToolResult, isToolErrorResult, buildToolRecoveryHint } from './tool-protocol';

export const CIRCUIT_BREAKER_FAILURE_LIMIT = 3;
export const CIRCUIT_BREAKER_LOOP_LIMIT = 5;
export const DUPLICATE_CALL_LIMIT = 3;

export interface ToolExecState {
  recentToolCalls: Array<{ name: string; args: string }>;
  consecutiveFailures: number;
  circuitBroken: boolean;
}

export function createToolExecState(): ToolExecState {
  return {
    recentToolCalls: [],
    consecutiveFailures: 0,
    circuitBroken: false,
  };
}

export function processToolResult(
  state: ToolExecState,
  tc: Pick<XmlToolCall, 'name' | 'arguments'>,
  rawResult: string,
): { result: string; shouldBreak: boolean } {
  let finalResult = truncateToolResult(buildToolRecoveryHint(tc, rawResult));
  let shouldBreak = false;

  if (isToolErrorResult(rawResult)) {
    state.consecutiveFailures++;
  } else {
    state.consecutiveFailures = 0;
  }

  if (state.consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_LIMIT) {
    finalResult += `\n\n[CIRCUIT BREAKER] STOP! You have failed ${state.consecutiveFailures} times in a row. Do NOT retry the same operation. Instead: 1) Analyze what went wrong, 2) Try a completely different approach, 3) If you cannot proceed, summarize what you have accomplished so far and stop.`;
  }

  const tcSig = `${tc.name}:${(tc.arguments || '').substring(0, 100)}`;
  state.recentToolCalls.push({ name: tc.name, args: tcSig });
  if (state.recentToolCalls.length > 20) state.recentToolCalls.shift();
  const recentSameType = state.recentToolCalls.filter((t) => t.name === tc.name).length;
  const recentSameSig = state.recentToolCalls.filter((t) => t.args === tcSig).length;

  if (recentSameSig > DUPLICATE_CALL_LIMIT && !isToolErrorResult(rawResult)) {
    finalResult += `\n\n[Duplicate Detection] You have called '${tc.name}' with the SAME arguments ${recentSameSig} times and it SUCCEEDED each time. This is a duplicate loop. The operation is already done - do NOT call this tool again with the same arguments. Tell the user the result and stop retrying.`;
    if (recentSameSig >= DUPLICATE_CALL_LIMIT + 2) {
      shouldBreak = true;
    }
  }

  if (tc.name === 'bash' && !shouldBreak) {
    const fileOpenMatch = tc.arguments?.match(/["']?([A-Za-z]:\\[^\s"']+?\.(?:html?|htm|pdf|png|jpg|jpeg|svg|mp4|mp3|wav|txt|md|docx?|xlsx?|pptx?))["']?/i);
    if (fileOpenMatch) {
      const targetFile = fileOpenMatch[1].toLowerCase().replace(/\\/g, '/');
      const sameFileOpens = state.recentToolCalls.filter((t) => {
        const match = t.args.match(/["']?([A-Za-z]:\\[^\s"']+?\.(?:html?|htm|pdf|png|jpg|jpeg|svg|mp4|mp3|wav|txt|md|docx?|xlsx?|pptx?))["']?/i);
        return match && match[1].toLowerCase().replace(/\\/g, '/') === targetFile;
      }).length;
      if (sameFileOpens > DUPLICATE_CALL_LIMIT && !isToolErrorResult(rawResult)) {
        finalResult += `\n\n[Duplicate File Open] You have tried to open '${targetFile}' ${sameFileOpens} times using different methods. It has already been opened successfully. Do NOT try to open this file again by any method. Tell the user the file is open and stop.`;
        if (sameFileOpens >= DUPLICATE_CALL_LIMIT + 2) {
          shouldBreak = true;
        }
      }
    }
  }

  const isBulkTool = tc.name === 'write' || tc.name === 'read' || tc.name === 'bash' || tc.name === 'edit';
  const isCustomTool = tc.name === 'executeCustomTool';
  const loopLimit = isBulkTool ? 15 : isCustomTool ? 8 : CIRCUIT_BREAKER_LOOP_LIMIT;

  if (recentSameType >= loopLimit) {
    finalResult += `\n\n[CIRCUIT BREAKER] EMERGENCY STOP! You have called '${tc.name}' ${recentSameType} times recently. This is a loop. You MUST stop calling tools immediately and return a summary of what you have done so far.`;
    shouldBreak = true;
    state.recentToolCalls.length = 0;
  } else if (recentSameType >= (isBulkTool ? 10 : isCustomTool ? 5 : 3) && !isToolErrorResult(rawResult)) {
    finalResult += `\n\n[Loop Detection] You have called '${tc.name}' ${recentSameType} times recently. If you are stuck, try a completely different approach or ask the user for clarification.`;
  }

  return { result: finalResult, shouldBreak };
}
