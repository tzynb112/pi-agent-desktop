import assert from 'assert/strict';
import { TOOLS_DEFINITION } from '../src/renderer/config/tools';
import { buildSystemPrompt } from '../src/renderer/config/system-prompt';

const searchTool = TOOLS_DEFINITION.find((tool) => tool.function.name === 'search');
assert.ok(searchTool, 'expected built-in search tool to exist');
assert.deepEqual(searchTool?.function.parameters.required, ['query']);

const prompt = buildSystemPrompt({
  selectedTools: ['read', 'bash', 'edit', 'write', 'web', 'search'],
});

assert.match(prompt, /Use `search` to discover relevant pages/i);
assert.match(prompt, /Use `web` only after you already have a specific URL/i);

console.log('search tool and prompt test passed');
