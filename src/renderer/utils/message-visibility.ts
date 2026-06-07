import type { ChatMessage } from '../types';

export function isRenderableChatMessage(message: ChatMessage): boolean {
  return !message.hidden && !message.id.startsWith('tool_res_');
}
