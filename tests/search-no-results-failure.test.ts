import assert from 'assert/strict';
import { createToolExecState, processToolResult } from '../src/renderer/utils/tool-exec-loop';
import { isToolErrorResult } from '../src/renderer/utils/tool-execution';

const searchQuery = 'GPT-5.4 mini';
const emptySearchOutput = `No search results found for: ${searchQuery}`;

assert.equal(
  isToolErrorResult(emptySearchOutput),
  true,
  'expected empty search output to count as a tool failure',
);

const state = createToolExecState();
const toolCall = {
  name: 'search',
  arguments: JSON.stringify({ query: searchQuery, max_results: 5 }),
} as const;

const processed = processToolResult(state, toolCall as any, emptySearchOutput);

assert.equal(state.consecutiveFailures, 1, 'empty search output should increment failure count');
assert.match(processed.result, /Recovery Hint/i);
assert.match(
  processed.result,
  /broaden|remove quotes|summarize|different query/i,
  'expected search-specific recovery guidance',
);

console.log('search no-results failure test passed');
