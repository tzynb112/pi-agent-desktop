import assert from 'assert/strict';
import {
  buildNoToolCallHint,
  looksLikeCompletionResponse,
} from '../src/shared/tool-call-recovery';

assert.equal(looksLikeCompletionResponse('I will tidy this up and verify:'), false);
assert.equal(looksLikeCompletionResponse('Done.'), true);

const hint = buildNoToolCallHint('Current request: open the file', 'I will tidy this up and verify:', 0);
assert.match(hint, /Current request: open the file/);
assert.match(hint, /Previous assistant response:/);
assert.match(hint, /I will tidy this up and verify:/);
assert.match(hint, /No XML tool call was emitted/);

console.log('tool-call-recovery tests passed');
