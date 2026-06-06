/**
 * Context window builder for PianoAgent.
 * Handles smart sliding-window truncation of conversation history
 * to stay within model context limits.
 */

import type { ChatMessage } from "../types";

interface BuildContextOptions {
  maxContextChars?: number;
  windowSize?: number;
  aggressiveWindowSize?: number;
  gitContext?: string;
  projectInfo?: string;
}

/**
 * Build trimmed messages for the API call with smart context windowing.
 */
export function buildTrimmedMessages(
  messages: ChatMessage[],
  systemPrompt: string,
  options: BuildContextOptions = {},
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const {
    maxContextChars = 150000,
    windowSize = 500,
    aggressiveWindowSize = 50,
    gitContext,
    projectInfo,
  } = options;

  const historyMessages = messages
    .filter((m) => !m.isStreaming && m.content)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  let slicedHistory = historyMessages.slice(-windowSize);

  const systemPromptChars = systemPrompt.length;
  const historyChars = slicedHistory.reduce(
    (sum, m) => sum + (m.content?.length || 0),
    0,
  );
  const totalChars = systemPromptChars + historyChars;

  if (totalChars > maxContextChars) {
    slicedHistory = historyMessages.slice(-aggressiveWindowSize);
    console.log(
      "[Context] Truncated from " + historyMessages.length + " to " + aggressiveWindowSize +
      " messages (estimated " + totalChars + " chars exceeded " + maxContextChars + " limit)",
    );
  }

  const trimmedMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: systemPrompt }];

  trimmedMessages.push(...slicedHistory);

  // Inject dynamic environment context (gitContext and projectInfo) into the LAST user message
  if (trimmedMessages.length > 0) {
    for (let i = trimmedMessages.length - 1; i >= 0; i--) {
      if (trimmedMessages[i].role === "user") {
        let extraContent = "";
        if (projectInfo) {
          extraContent += `\n\n### Current Project Structure:\n${projectInfo}`;
        }
        if (gitContext) {
          extraContent += `\n\n### Git Status & Context:\n${gitContext}`;
        }
        if (extraContent) {
          trimmedMessages[i] = {
            ...trimmedMessages[i],
            content: trimmedMessages[i].content + extraContent,
          };
        }
        break;
      }
    }
  }

  return trimmedMessages;
}
