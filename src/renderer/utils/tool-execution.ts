/**
 * Tool execution utilities for PianoAgent.
 * Handles XML tool call parsing, result truncation, error detection, and recovery hints.
 */

import type { ToolCall } from '../types';

const CHAT_ONLY_PATTERNS = [
  /^(hi|hello|hey|yo|ok|okay|thanks|thank you|thx|smoke|test)$/i,
  /^(\u4f60\u597d|\u60a8\u597d|\u5728\u5417|\u8c22\u8c22|\u597d\u7684|\u597d|\u884c|\u53ef\u4ee5|\u55ef|\u54e6|\u6d4b\u8bd5)$/i,
];

const TOOL_INTENT_PATTERN =
  /(read|write|edit|create|delete|rename|move|run|execute|test|debug|fix|open|inspect|review|search|find|list|show|build|install|deploy|model|profile|config|setting|settings|switch|change|pro|flash|deepseek|\u542f\u52a8|\u8fd0\u884c|\u6267\u884c|\u6d4b\u8bd5|\u8c03\u8bd5|\u4fee\u590d|\u4fee\u6539|\u7f16\u8f91|\u521b\u5efa|\u65b0\u5efa|\u5220\u9664|\u91cd\u547d\u540d|\u79fb\u52a8|\u6253\u5f00|\u67e5\u770b|\u8bfb\u53d6|\u641c\u7d22|\u67e5\u627e|\u5217\u51fa|\u5ba1\u67e5|\u6784\u5efa|\u5b89\u88c5|\u90e8\u7f72|\u6587\u4ef6|\u76ee\u5f55|\u6587\u4ef6\u5939|\u4ee3\u7801|\u9879\u76ee|\u62a5\u9519|\u9519\u8bef|bug|\u7ec8\u7aef|\u547d\u4ee4|\u5de5\u5177|\u6a21\u578b|\u5e95\u5c42|\u914d\u7f6e|\u8bbe\u7f6e|\u5207\u6362|\u66f4\u6362|\u6539\u6210|\u6539|goal|mcp)/i;

/**
 * Decide whether assistant tool calls should be honored for this user turn.
 * This is a safety net for short casual messages that models sometimes over-interpret
 * as development tasks.
 */
export function shouldAllowToolCallsForUserInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/')) return true;

  const normalized = trimmed.replace(/[.!?。！？~～\s]+$/g, '').trim();
  if (CHAT_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (normalized.length <= 12 && !TOOL_INTENT_PATTERN.test(normalized)) return false;

  return TOOL_INTENT_PATTERN.test(trimmed);
}

/**
 * Parse XML-style tool calls from assistant response text.
 * Supports: <read>, <bash>, <edit>, <write>, <config> tags.
 */
export function parseXmlToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const toolNames = ['read', 'bash', 'edit', 'write', 'config'];

  for (const toolName of toolNames) {
    const openTag = `<${toolName}>`;
    const closeTag = `</${toolName}>`;
    let searchFrom = 0;

    while (true) {
      const startIdx = text.indexOf(openTag, searchFrom);
      if (startIdx === -1) break;
      const contentStart = startIdx + openTag.length;
      const endIdx = text.indexOf(closeTag, contentStart);
      if (endIdx === -1) {
        searchFrom = contentStart;
        continue;
      }

      const innerContent = text.substring(contentStart, endIdx).trim();
      const args: Record<string, string> = {};

      const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(innerContent)) !== null) {
        args[paramMatch[1]] = paramMatch[2].trim();
      }

      if (Object.keys(args).length > 0) {
        toolCalls.push({
          id: `tool_${Date.now()}_${toolCalls.length}`,
          name: toolName,
          arguments: JSON.stringify(args),
        });
      }

      searchFrom = endIdx + closeTag.length;
    }
  }

  return toolCalls;
}

/**
 * Smart truncation of tool results for token efficiency.
 * Preserves error/warning lines and adds context-aware truncation markers.
 */
export function truncateToolResult(result: string, maxLength = 8000): string {
  if (!result || result.length <= maxLength) return result;

  const lines = result.split('\n');
  const truncatedCount = result.length - maxLength;

  // Extract error/warning lines (keep these)
  const importantIndices = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/error|fatal|exception|failed|traceback|panic/i.test(line)) {
      for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 3); j++) {
        importantIndices.add(j);
      }
    }
  }

  // If there are important lines, build a smart truncation
  if (importantIndices.size > 0 && importantIndices.size < lines.length) {
    // Always keep first 5 lines (command output header)
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      importantIndices.add(i);
    }

    // Build output with gaps marked
    const allImportant = Array.from(importantIndices).sort((a, b) => a - b);
    const kept: string[] = [];
    let lastIdx = -2;

    for (const idx of allImportant) {
      if (idx - lastIdx > 1 && kept.length > 0) {
        const gap = idx - lastIdx - 1;
        kept.push(`\n... [${gap} lines omitted] ...\n`);
      }
      kept.push(lines[idx]);
      lastIdx = idx;
    }

    const resultText = kept.join('\n');
    if (resultText.length < result.length * 0.8) {
      return `${resultText}\n\n[TRUNCATED ${truncatedCount} chars  - error/warning lines preserved. Use more specific commands to see full output.]`;
    }
  }

  // Fallback: head + tail truncation
  const half = Math.floor(maxLength / 2);
  const head = result.substring(0, half);
  const tail = result.substring(result.length - half);

  return `${head}\n\n... [TRUNCATED ${truncatedCount} CHARACTERS FOR TOKEN EFFICIENCY. If you need to see other parts of the file or command output, use more specific commands or tools.] ...\n\n${tail}`;
}

/**
 * Check if a tool result is an error.
 */
export function isToolErrorResult(result?: string): boolean {
  return !!result && (/^\s*Error:/i.test(result) || /工具失败[:：]/i.test(result));
}

/**
 * Build context-aware recovery hints for failed tool calls.
 */
export function buildToolRecoveryHint(toolCall: ToolCall, result: string): string {
  if (!isToolErrorResult(result)) return result;

  const lower = result.toLowerCase();
  const hint = [result, '', '[Recovery Hint]'];

  if (lower.includes('enoent') || lower.includes('no such file')) {
    hint.push('File or path not found  - use `read` or `bash ls` to verify the correct path first.');
  } else if (lower.includes('permission') || lower.includes('access denied')) {
    hint.push('Permission denied  - check file permissions or try running with elevated privileges.');
  } else if (lower.includes('old_str not found') || (toolCall.name === 'edit' && lower.includes('not found'))) {
    hint.push('Edit match failed  - read the file first to get the exact content, then retry with a shorter, more precise old_str.');
  } else if (lower.includes('syntax') || lower.includes('unexpected token')) {
    hint.push('Syntax error  - read the file to understand its structure before editing.');
  } else if (lower.includes('timeout') || lower.includes('timed out')) {
    hint.push('Command timed out  - try a more targeted command or break it into smaller steps.');
  } else if (toolCall.name === 'bash') {
    hint.push('On Windows, prefer PowerShell syntax. Quote paths with spaces or non-ASCII characters. Use Get-ChildItem/Get-Content/Select-String/Get-Location.');
  } else {
    hint.push('Analyze the error and continue with a smaller, safer next step instead of stopping.');
  }

  return hint.join('\n');
}
