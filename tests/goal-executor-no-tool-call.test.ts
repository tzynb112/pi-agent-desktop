import assert from 'assert/strict';
import { executeSubTask, type Goal, type SubTask } from '../src/shared/goal-executor';

async function main() {
  const prompts: string[] = [];
  const toolCalls: Array<{ toolName: string; args: string }> = [];
  const responses = [
    '<bash><command>echo first</command></bash>',
    'I will tidy this up and verify:',
    '<bash><command>echo second</command></bash>',
    'Done.',
  ];

  let responseIndex = 0;

  const callLLM = async (prompt: string) => {
    prompts.push(prompt);
    const response = responses[responseIndex];
    responseIndex += 1;
    if (response === undefined) {
      throw new Error(`Unexpected LLM call #${responseIndex}`);
    }
    return response;
  };

  const executeTool = async (toolName: string, args: string) => {
    toolCalls.push({ toolName, args });
    return `ok:${toolName}:${args}`;
  };

  const goal: Goal = {
    id: 'goal-1',
    description: 'Keep going when the model briefly talks without tools',
    status: 'executing',
    createdAt: 0,
    updatedAt: 0,
    subTasks: [],
  };

  const task: SubTask = {
    id: 'task-1',
    goalId: goal.id,
    description: 'Continue after a non-final assistant reply with no XML tool call',
    status: 'executing',
    dependencies: [],
  };

  const result = await executeSubTask(task, goal, callLLM, executeTool);

  assert.equal(result, 'Done.');
  assert.equal(toolCalls.length, 2);
  assert.equal(toolCalls[0].toolName, 'bash');
  assert.match(toolCalls[0].args, /echo first/);
  assert.equal(toolCalls[1].toolName, 'bash');
  assert.match(toolCalls[1].args, /echo second/);
  assert.equal(prompts.length, 4);

  const historyAfterHint = JSON.parse(prompts[2]) as Array<{ role: string; content: string }>;
  assert.ok(
    historyAfterHint.some(
      (message) =>
        message.role === 'user' &&
        message.content.includes('No XML tool call was emitted')
    )
  );

  console.log('goal-executor no-tool-call continuation test passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
