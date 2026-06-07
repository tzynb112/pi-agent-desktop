/**
 * Tool execution loop utilities for PianoAgent.
 * Handles circuit breaker, loop detection, and tool call batching.
 */

import type { ToolCall } from "../types";
import { truncateToolResult, isToolErrorResult, buildToolRecoveryHint } from "./tool-execution";

/** Default circuit breaker thresholds */
export const CIRCUIT_BREAKER_FAILURE_LIMIT = 10;
export const CIRCUIT_BREAKER_LOOP_LIMIT = 25;
export const DUPLICATE_CALL_LIMIT = 5;

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

  if (isToolErrorResult(rawResult)) {
    state.consecutiveFailures++;
  } else {
    state.consecutiveFailures = 0;
  }

  if (state.consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_LIMIT) {
    finalResult += "\n\n[Recovery Hint] You have failed " + state.consecutiveFailures +
      " times in a row. Stop repeating the same command and switch strategy, but keep moving toward the task.";
  }

  const tcSig = tc.name + ":" + (tc.arguments || "").substring(0, 300);
  state.recentToolCalls.push({ name: tc.name, args: tcSig });
  if (state.recentToolCalls.length > 50) state.recentToolCalls.shift();
  const recentSameType = state.recentToolCalls.filter((t) => t.name === tc.name).length;

  const recentSameSig = state.recentToolCalls.filter((t) => t.args === tcSig).length;
  if (recentSameSig > DUPLICATE_CALL_LIMIT && !isToolErrorResult(rawResult)) {
    finalResult += "\n\n[Duplicate Detection] You have called '" + tc.name + "' with the same arguments " +
      recentSameSig + " times and it succeeded. Continue from the latest result and choose a different next step.";
  }

  if (tc.name === 'bash') {
    const fileOpenMatch = tc.arguments?.match(/["']?([A-Za-z]:\\[^\s"']+?\.(?:html?|htm|pdf|png|jpg|jpeg|svg|mp4|mp3|wav|txt|md|docx?|xlsx?|pptx?))["']?/i);
    if (fileOpenMatch) {
      const targetFile = fileOpenMatch[1].toLowerCase().replace(/\\/g, '/');
      const sameFileOpens = state.recentToolCalls.filter((t) => {
        const m = t.args.match(/["']?([A-Za-z]:\\[^\s"']+?\.(?:html?|htm|pdf|png|jpg|jpeg|svg|mp4|mp3|wav|txt|md|docx?|xlsx?|pptx?))["']?/i);
        return m && m[1].toLowerCase().replace(/\\/g, '/') === targetFile;
      }).length;
      if (sameFileOpens > DUPLICATE_CALL_LIMIT && !isToolErrorResult(rawResult)) {
        finalResult += "\n\n[Duplicate File Open] You have tried to open '" + targetFile + "' " +
          sameFileOpens + " times using different methods. It has already been opened successfully. " +
          "Continue from the opened file instead of trying to open it again.";
      }
    }
  }

  const isBulkTool = tc.name === 'write' || tc.name === 'read' || tc.name === 'bash' || tc.name === 'edit';
  const loopLimit = isBulkTool ? 45 : CIRCUIT_BREAKER_LOOP_LIMIT;
  const warningLimit = isBulkTool ? 20 : 10;

  if (recentSameType >= loopLimit) {
    finalResult += "\n\n[Loop Detection] You have called '" + tc.name + "' " + recentSameType +
      " times recently. Switch strategy and avoid repeating the same tool.";
    shouldBreak = true;
    state.recentToolCalls.length = 0;
  } else if (recentSameType >= warningLimit && !isToolErrorResult(rawResult)) {
    finalResult += "\n\n[Loop Detection] You have called '" + tc.name + "' " + recentSameType +
      " times recently. If you are stuck, try a different approach or continue from the latest result.";
  }

  return { result: finalResult, shouldBreak };
}
