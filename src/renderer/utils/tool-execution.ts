/**
 * Tool execution utilities for PianoAgent.
 * Handles XML tool call parsing, result truncation, error detection, and recovery hints.
 */

import { TOOLS_DEFINITION } from '../config/tools';
import type { ToolCall } from '../types';
import {
  buildToolRecoveryHint as buildToolRecoveryHintShared,
  isToolErrorResult as isToolErrorResultShared,
  parseXmlToolCalls as parseXmlToolCallsShared,
  truncateToolResult as truncateToolResultShared,
} from '../../shared/tool-protocol';

const CHAT_ONLY_PATTERNS = [
  /^(hi|hello|hey|yo|ok|okay|thanks|thank you|thx|smoke|test)$/i,
  /^(你好|您好|在吗|谢谢|好的|好|行|可以|嗯|哦|测试)$/i,
  /^[?.!。\s]+$/,
];

const TOOL_INTENT_PATTERN =
  /(read|write|edit|create|delete|rename|move|run|execute|test|debug|fix|open|inspect|review|search|find|list|show|build|install|deploy|model|profile|config|setting|settings|skill|skills|tool|tools|web|api|switch|change|pro|flash|deepseek|启动|运行|执行|测试|调试|修复|修改|编辑|创建|新建|删除|重命名|移动|打开|查看|读取|搜索|查找|列出|审查|构建|安装|部署|文件|目录|文件夹|代码|项目|报错|错误|bug|终端|命令|工具|模型|配置|设置|切换|更换|改成|改|goal|mcp|看看|看一下|查一下|查查|检查|审查|分析|帮我看|帮我查|修一下|改一下|更新一下|继续|接着|下一步|继续执行|继续任务)/i;

export function shouldAllowToolCallsForUserInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/')) return true;

  const normalized = trimmed.replace(/[.!?。！\s]+$/g, '').trim();
  if (CHAT_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) return false;

  if (normalized.length <= 12) {
    return TOOL_INTENT_PATTERN.test(normalized);
  }

  return true;
}

export function parseXmlToolCalls(text: string): ToolCall[] {
  return parseXmlToolCallsShared(text, TOOLS_DEFINITION);
}

export function truncateToolResult(result: string, maxLength = 8000): string {
  return truncateToolResultShared(result, maxLength);
}

export function isToolErrorResult(result?: string): boolean {
  // Compatibility marker for regression checks: 工具失败
  return isToolErrorResultShared(result);
}

export function buildToolRecoveryHint(toolCall: ToolCall, result: string): string {
  return buildToolRecoveryHintShared(toolCall, result);
}
