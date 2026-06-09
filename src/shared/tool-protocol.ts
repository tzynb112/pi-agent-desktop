export interface ToolParameterDefinition {
  required?: string[];
}

export interface ToolDefinitionLike {
  function: {
    name: string;
    parameters?: ToolParameterDefinition;
  };
}

export interface XmlToolCall {
  id: string;
  name: string;
  arguments: string;
}

export function parseXmlToolCalls(
  text: string,
  toolDefinitions: ToolDefinitionLike[],
): XmlToolCall[] {
  const toolCalls: XmlToolCall[] = [];
  const toolDefinitionsByName = new Map(toolDefinitions.map((tool) => [tool.function.name, tool]));
  const toolNames = toolDefinitions.map((tool) => tool.function.name);

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
      let paramMatch: RegExpExecArray | null;

      while ((paramMatch = paramRegex.exec(innerContent)) !== null) {
        args[paramMatch[1]] = paramMatch[2].trim();
      }

      const toolDef = toolDefinitionsByName.get(toolName);
      const requiredCount = Array.isArray(toolDef?.function?.parameters?.required)
        ? toolDef.function.parameters!.required!.length
        : 0;

      if (Object.keys(args).length > 0 || requiredCount === 0) {
        toolCalls.push({
          id: `tool_${Date.now()}_${toolCalls.length}`,
          name: toolName,
          arguments: Object.keys(args).length > 0 ? JSON.stringify(args) : '{}',
        });
      }

      searchFrom = endIdx + closeTag.length;
    }
  }

  return toolCalls;
}

export function truncateToolResult(result: string, maxLength = 8000): string {
  if (!result || result.length <= maxLength) return result;

  const lines = result.split('\n');
  const truncatedCount = result.length - maxLength;
  const importantIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/error|fatal|exception|failed|traceback|panic/i.test(line)) {
      for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 3); j++) {
        importantIndices.add(j);
      }
    }
  }

  if (importantIndices.size > 0 && importantIndices.size < lines.length) {
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      importantIndices.add(i);
    }

    const allImportant = Array.from(importantIndices).sort((a, b) => a - b);
    const kept: string[] = [];
    let lastIdx = -2;

    for (const idx of allImportant) {
      if (idx - lastIdx > 1 && kept.length > 0) {
        kept.push(`\n... [${idx - lastIdx - 1} lines omitted] ...\n`);
      }
      kept.push(lines[idx]);
      lastIdx = idx;
    }

    const resultText = kept.join('\n');
    if (resultText.length < result.length * 0.8) {
      return `${resultText}\n\n[TRUNCATED ${truncatedCount} chars - error/warning lines preserved. Use more specific commands to see full output.]`;
    }
  }

  const half = Math.floor(maxLength / 2);
  const head = result.substring(0, half);
  const tail = result.substring(result.length - half);
  return `${head}\n\n... [TRUNCATED ${truncatedCount} CHARACTERS FOR TOKEN EFFICIENCY. If you need to see other parts of the file or command output, use more specific commands or tools.] ...\n\n${tail}`;
}

export function isToolErrorResult(result?: string): boolean {
  return !!result && (
    /^\s*Error:/i.test(result) ||
    /tool failed|old_str not found|command exited with code|permission denied|access denied|enoent|timed out|timeout|fetch failed|mcp request/i.test(result)
  );
}

export function buildToolRecoveryHint(toolCall: Pick<XmlToolCall, 'name' | 'arguments'>, result: string): string {
  if (!isToolErrorResult(result)) return result;

  const lower = result.toLowerCase();
  const hint = [result, '', '[Recovery Hint]'];

  if (lower.includes('enoent') || lower.includes('no such file')) {
    hint.push('File or path not found - use `read` or `bash ls` to verify the correct path first.');
  } else if (lower.includes('permission') || lower.includes('access denied')) {
    hint.push('Permission denied - check file permissions or try running with elevated privileges.');
  } else if (lower.includes('old_str not found') || (toolCall.name === 'edit' && lower.includes('not found'))) {
    hint.push('Edit match failed - read the file first to get the exact content, then retry with a shorter, more precise old_str.');
  } else if (lower.includes('syntax') || lower.includes('unexpected token')) {
    hint.push('Syntax error - read the file to understand its structure before editing.');
  } else if (lower.includes('timeout') || lower.includes('timed out')) {
    hint.push('Command timed out - try a more targeted command or break it into smaller steps.');
  } else if (toolCall.name === 'bash') {
    hint.push('On Windows, prefer PowerShell syntax. Quote paths with spaces or non-ASCII characters. Use Get-ChildItem/Get-Content/Select-String/Get-Location.');
  } else {
    hint.push('Analyze the error and continue with a smaller, safer next step instead of stopping.');
  }

  return hint.join('\n');
}
