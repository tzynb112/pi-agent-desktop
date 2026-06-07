import assert from 'assert/strict';
import { createToolExecState, processToolResult } from '../src/renderer/utils/tool-exec-loop';

const state = createToolExecState();
const toolCall = {
  name: 'web',
  arguments: JSON.stringify({ url: 'https://example.com' }),
} as const;

const first = processToolResult(state, toolCall as any, 'Error: fetch failed');
assert.equal(first.shouldBreak, false);

const second = processToolResult(state, toolCall as any, 'Error: fetch failed');
assert.equal(second.shouldBreak, false);

const third = processToolResult(state, toolCall as any, 'Error: fetch failed');
assert.equal(third.shouldBreak, true);
assert.match(third.result, /CIRCUIT BREAKER/);

console.log('tool-exec-loop circuit breaker test passed');
