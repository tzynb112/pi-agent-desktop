/**
 * Tool execution loop utilities for PianoAgent.
 * Handles circuit breaker, loop detection, and tool call batching.
 */

import type { ToolCall } from "../types";
import { truncateToolResult, isToolErrorResult, buildToolRecoveryHint } from "./tool-execution";
import {
  extractGuiLaunchTarget,
  normalizeGuiLaunchTarget,
} from "../../shared/gui-launch-detection";

/** Default circuit breaker thresholds */
export const CIRCUIT_BREAKER_FAILURE_LIMIT = 3;
export const CIRCUIT_BREAKER_LOOP_LIMIT = 5;
export const DUPLICATE_CALL_LIMIT = 1;

export interface ToolExecState {
  recentToolCalls: Array<{ name: string; args: string }>;
  consecutiveFailures: number;
  circuitBroken: boolean;
}

/** Create initial tool execution state */
export function createToolExecState(): ToolExecState {
  return {
    recentToolCalls: [],
    consecutiveFailures: 0,
    circuitBroken: false,
  };
}

/**
 * Process a single tool call result with circuit breaker and loop detection.
 * Returns the final result string to send back to the LLM.
 */
export function processToolResult(
  state: ToolExecState,
  tc: ToolCall,
  rawResult: string,
): { result: string; shouldBreak: boolean } {
  let finalResult = truncateToolResult(buildToolRecoveryHint(tc, rawResult));
  let shouldBreak = false;

  // Track consecutive failures
  if (isToolErrorResult(rawResult)) {
    state.consecutiveFailures++;
  } else {
    state.consecutiveFailures = 0;
  }

  // Circuit breaker: consecutive failures inject stop prompt
  // Note: do NOT reset consecutiveFailures here; only reset on success (above).
  // This ensures the circuit breaker keeps firing if the LLM ignores the stop prompt.
  if (state.consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_LIMIT) {
    finalResult += "\n\n[CIRCUIT BREAKER] STOP! You have failed " + state.consecutiveFailures +
      " times in a row. Do NOT retry the same operation. Instead: 1) Analyze what went wrong, " +
      "2) Try a completely different approach, 3) If you cannot proceed, summarize what you have accomplished so far and stop.";
  }

  // Loop detection: track recent tool calls
  const tcSig = tc.name + ":" + (tc.arguments || "").substring(0, 100);
  state.recentToolCalls.push({ name: tc.name, args: tcSig });
  if (state.recentToolCalls.length > 10) state.recentToolCalls.shift();
  const recentSameType = state.recentToolCalls.filter(t => t.name === tc.name).length;

  // Duplicate call detection: same tool + same args
  const recentSameSig = state.recentToolCalls.filter(t => t.args === tcSig).length;
  if (recentSameSig > DUPLICATE_CALL_LIMIT && !isToolErrorResult(rawResult)) {
    finalResult += "\n\n[Duplicate Detection] You have called '" + tc.name + "' with the SAME arguments " +
      recentSameSig + " times and it SUCCEEDED each time. This is a duplicate loop. " +
      "The operation is already done — do NOT call this tool again with the same arguments. " +
      "Tell the user the result and stop retrying.";
    shouldBreak = true;
  }

  // GUI file-open duplicate detection: if multiple bash calls try to open the same file
  // (even with different methods like Start-Process, msedge.exe, cmd /c start, etc.)
  if (tc.name === 'bash' && !shouldBreak) {
    const target = extractGuiLaunchTarget(tc.arguments || '');
    if (target) {
      const targetFile = normalizeGuiLaunchTarget(target);
      const sameFileOpens = state.recentToolCalls.filter(t => {
        const m = extractGuiLaunchTarget(t.args || '');
        return m && normalizeGuiLaunchTarget(m) === targetFile;
      }).length;
      if (sameFileOpens > DUPLICATE_CALL_LIMIT && !isToolErrorResult(rawResult)) {
        finalResult += "\n\n[Duplicate File Open] You have tried to open '" + targetFile + "' " +
          sameFileOpens + " times using different methods. It has already been opened successfully. " +
          "Do NOT try to open this file again by any method. Tell the user the file is open and stop.";
        shouldBreak = true;
      }
    }
  }

  // Circuit breaker: too many same-type calls
  if (recentSameType >= CIRCUIT_BREAKER_LOOP_LIMIT) {
    finalResult += "\n\n[CIRCUIT BREAKER] EMERGENCY STOP! You have called " + "'" + tc.name + "'" +
      " " + recentSameType + " times in a row. This is a loop. You MUST stop calling tools immediately and return a summary of what you have done so far.";
    shouldBreak = true;
    state.recentToolCalls.length = 0;
  } else if (recentSameType >= 3 && !isToolErrorResult(rawResult)) {
    finalResult += "\n\n[Loop Detection] You have called " + "'" + tc.name + "'" +
      " " + recentSameType + " times recently. If you are stuck, try a completely different approach or ask the user for clarification.";
  }

  return { result: finalResult, shouldBreak };
}
