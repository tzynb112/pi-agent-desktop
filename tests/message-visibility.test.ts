import assert from 'assert/strict';
import { isRenderableChatMessage } from '../src/renderer/utils/message-visibility';
import type { ChatMessage } from '../src/renderer/types';

const visibleMessage: ChatMessage = {
  id: 'msg-1',
  role: 'assistant',
  content: 'hello',
  timestamp: 0,
};

const hiddenMessage: ChatMessage = {
  id: 'msg-2',
  role: 'user',
  content: 'internal control prompt',
  timestamp: 0,
  hidden: true,
};

const toolResultMessage: ChatMessage = {
  id: 'tool_res_123',
  role: 'user',
  content: 'tool output',
  timestamp: 0,
};

assert.equal(isRenderableChatMessage(visibleMessage), true);
assert.equal(isRenderableChatMessage(hiddenMessage), false);
assert.equal(isRenderableChatMessage(toolResultMessage), false);

console.log('message-visibility tests passed');
