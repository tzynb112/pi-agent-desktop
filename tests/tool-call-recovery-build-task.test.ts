import assert from 'assert/strict';
import { buildSystemPrompt } from '../src/renderer/config/system-prompt';
import { buildNoToolCallHint } from '../src/shared/tool-call-recovery';

const prompt = buildSystemPrompt({
  selectedTools: ['read', 'bash', 'edit', 'write'],
});

assert.match(
  prompt,
  /do not stop at a structure, outline, or architecture summary/i,
  'expected build-oriented prompt guidance to require implementation, not just architecture',
);

const hint = buildNoToolCallHint(
  'Current request: 写一个校园代跑系统',
  '好的，我来为你构建一个完整的校园代跑系统，下面是项目结构。',
  0,
);

assert.match(
  hint,
  /structure or outline is not enough/i,
  'expected recovery hint to reject structure-only replies',
);
assert.match(
  hint,
  /start implementing|emit exactly one XML tool call/i,
  'expected recovery hint to tell the model to keep executing',
);

console.log('tool-call recovery build-task test passed');
