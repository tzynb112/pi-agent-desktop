import type { ChatMessage, Conversation, ToolCall } from '../types';

const TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'config'];

function stripXmlToolCalls(text: string): string {
  let result = text;
  for (const name of TOOL_NAMES) {
    result = result.replace(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'gi'), '');
    result = result.replace(new RegExp(`<${name}>`, 'gi'), '');
    result = result.replace(new RegExp(`</${name}>`, 'gi'), '');
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function stripLeakedReasoningSections(text: string): string {
  if (!text) return text;

  const labels = [
    ['深度', '思考', '过程'].join(''),
    ['思考', '过程'].join(''),
    ['推理', '过程'].join(''),
    ['Reasoning', 'Process'].join(' '),
    ['Thinking', 'Process'].join(' '),
    ['Chain', 'of', 'Thought'].join(' '),
  ];
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const headingPattern = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?(?:🧠\\s*)?(?:${escapedLabels.join('|')})(?:\\s*\\([^\\)\\n]*\\))?\\s*$`,
    'im'
  );

  let result = text;
  while (true) {
    const match = headingPattern.exec(result);
    if (!match) break;

    const before = result.slice(0, match.index).trimEnd();
    const afterHeading = result.slice(match.index + match[0].length);
    const paragraphEnd = afterHeading.search(/\r?\n\s*\r?\n/);

    if (paragraphEnd === -1) {
      result = before;
      break;
    }

    const afterReasoning = afterHeading.slice(paragraphEnd).replace(/^\s+/, '');
    result = `${before}${before && afterReasoning ? '\n\n' : ''}${afterReasoning}`;
  }

  return result.replace(/\n{3,}/g, '\n\n').trim();
}

export function sanitizeAssistantDisplayContent(text: string): string {
  return stripLeakedReasoningSections(stripXmlToolCalls(text || ''));
}

export function sanitizeToolCall(toolCall: ToolCall): ToolCall {
  return {
    ...toolCall,
    result: toolCall.result === undefined ? undefined : sanitizeAssistantDisplayContent(toolCall.result),
    liveOutput: toolCall.liveOutput === undefined ? undefined : sanitizeAssistantDisplayContent(toolCall.liveOutput),
  };
}

export function sanitizeChatMessage(message: ChatMessage): ChatMessage {
  if (message.role !== 'assistant') return message;
  return {
    ...message,
    content: sanitizeAssistantDisplayContent(message.content),
    reasoningContent: undefined,
    toolCalls: message.toolCalls?.map(sanitizeToolCall),
  };
}

export function sanitizeConversations(conversations: Conversation[]): Conversation[] {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map(sanitizeChatMessage),
  }));
}
