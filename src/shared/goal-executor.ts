import {
  isToolErrorResult as sharedIsToolErrorResult,
  parseXmlToolCalls,
  type ToolDefinitionLike,
} from './tool-protocol';
import { createToolExecState, processToolResult } from './tool-exec-loop';

/**

 * Goal Executor - Multi-agent long-running goal execution system
 * Similar to Codex, Claude Code, and Antigravity 2.0's /goal command
 */

export interface Goal {
  id: string;
  description: string;
  status: 'pending' | 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
  subTasks: SubTask[];
  result?: string;
  error?: string;
}

export interface SubTask {
  id: string;
  goalId: string;
  description: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  dependencies: string[];  // IDs of sub-tasks that must complete first
  agentId?: string;
  result?: string;
  error?: string;
  progress?: number;  // 0-100
  attempts?: number;
  filesChanged?: string[];  // Files modified by this sub-task
  verified?: boolean;
  verificationEvidence?: string[];
  currentTool?: { name: string; target: string; startedAt: number };  // Currently executing tool
  recentTools?: Array<{ name: string; target: string; success: boolean; at: number }>;  // Recent tool history
}

export interface Agent {
  id: string;
  name: string;
  status: 'idle' | 'busy';
  currentTaskId?: string;
  capabilities: string[];
}

export interface GoalPlan {
  goal: string;
  subTasks: Array<{
    id: string;
    description: string;
    dependencies: string[];
    estimatedComplexity: 'low' | 'medium' | 'high';
  }>;
  estimatedTime: number;  // in minutes
  parallelExecution: boolean;
}

export type GoalEvent = 
  | { type: 'goal_created'; goal: Goal }
  | { type: 'goal_planning'; goalId: string }
  | { type: 'goal_plan_created'; goalId: string; plan: GoalPlan }
  | { type: 'subtask_started'; goalId: string; subtaskId: string; agentId: string }
  | { type: 'subtask_progress'; goalId: string; subtaskId: string; progress: number }
  | { type: 'subtask_completed'; goalId: string; subtaskId: string; result: string }
  | { type: 'subtask_failed'; goalId: string; subtaskId: string; error: string }
  | { type: 'goal_completed'; goalId: string; result: string }
  | { type: 'goal_failed'; goalId: string; error: string };

export type GoalEventHandler = (event: GoalEvent) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryAsync<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  label: string
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      console.warn(`[GoalExecutor] ${label} failed (${attempt}/${maxAttempts}):`, err?.message || err);
      if (attempt < maxAttempts) {
        await sleep(600 * attempt);
      }
    }
  }

  throw lastError || new Error(`${label} failed`);
}

function isToolErrorResult(result: string): boolean {
  return sharedIsToolErrorResult(result) || (result || '').includes('工具失败');
}

const isToolError = isToolErrorResult;

/**
 * Parse /goal command and extract goal description
 */
export function parseGoalCommand(input: string): string | null {
  const match = input.trim().match(/^\/goal\s+(.+)$/s);
  return match ? match[1].trim() : null;
}

/**
 * Create a new goal
 */
export function createGoal(description: string): Goal {
  return {
    id: `goal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    description,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    subTasks: [],
  };
}

/**
 * Generate a plan for achieving the goal using LLM
 */
export async function generateGoalPlan(
  goal: Goal,
  callLLM: (prompt: string) => Promise<string>,
  context?: { files?: string[]; projectInfo?: string }
): Promise<GoalPlan> {
  return generateReliableGoalPlan(goal, callLLM, context);
}
/**
 * Execute a sub-task using an agent
 */
export async function executeSubTask(
  task: SubTask,
  goal: Goal,
  callLLM: (prompt: string) => Promise<string>,
  executeTool: (toolName: string, args: string) => Promise<string>,
  onProgress?: (progress: number) => void,
  onToolCall?: (toolName: string, target: string, result?: string, success?: boolean) => void,
  shouldStop?: GoalStopChecker
): Promise<string> {
  const result = await executeReliableSubTaskDetailed(
    task,
    goal,
    callLLM,
    executeTool,
    onProgress,
    onToolCall,
    shouldStop
  );
  return result.summary;
}
/**
 * Parse tool calls from LLM response 閳?optimized single-pass regex
 */
function parseToolCalls(text: string): Array<{ name: string; arguments: string }> {
  const toolDefinitions: ToolDefinitionLike[] = [
    { function: { name: 'read', parameters: { required: ['file_path'] } } },
    { function: { name: 'write', parameters: { required: ['file_path', 'content'] } } },
    { function: { name: 'edit', parameters: { required: ['file_path', 'old_str', 'new_str'] } } },
    { function: { name: 'bash', parameters: { required: ['command'] } } },
  ];

  return parseXmlToolCalls(text, toolDefinitions).map((toolCall) => ({
    name: toolCall.name,
    arguments: toolCall.arguments,
  }));
}

/**
 * Build a context-aware retry hint based on the error message.
 */
function buildRetryHint(error: string, attempt: number): string {
  const lower = error.toLowerCase();
  const hints: string[] = [];

  if (lower.includes('enoent') || lower.includes('no such file') || lower.includes('not found')) {
      hints.push('文件或路径不存在 — 先用 read 或 bash ls 确认正确的路径再操作');
  } else if (lower.includes('permission') || lower.includes('access denied') || lower.includes('eacces')) {
      hints.push('权限不足 — 检查文件权限，或尝试用管理员权限执行');
  } else if (lower.includes('syntax') || lower.includes('unexpected token') || lower.includes('parse')) {
      hints.push('语法错误 — 先读取文件了解结构，再进行编辑');
  } else if (lower.includes('timeout') || lower.includes('timed out')) {
      hints.push('命令超时 — 尝试更精确的命令或分步执行');
  } else if (lower.includes('old_str not found') || lower.includes('old_str')) {
      hints.push('编辑匹配失败 — 先用 read 查看文件内容，使用更短、更精确的 old_str');
  } else if (lower.includes('command exited') || lower.includes('error:')) {
      hints.push('Windows 环境请使用 PowerShell 语法，路径含空格或中文时加引号');
  } else {
      hints.push('分析错误原因，改用更小、更安全的步骤继续');
  }

  hints.push('分析失败原因，换一种更稳妥的方法继续');
  hints.push(`第 ${attempt + 1} 次重试: 请不要重复之前失败的操作，换一种完全不同的方法。`);

  return hints.join('\n');
}

type TaskAction = {
  tool: string;
  success: boolean;
  target: string;
  content?: string;
  oldStr?: string;
  newStr?: string;
};

type TaskExecutionResult = {
  summary: string;
  actionsTaken: TaskAction[];
  changedFiles: string[];
  verified: boolean;
  verificationEvidence: string[];
  finalAssistantResponse: string;
};

type GoalStopSignal = {
  action: 'pause' | 'cancel' | 'stop';
  reason?: string;
};

type GoalStopChecker = (() => GoalStopSignal | null | undefined) | undefined;

function taskTouchesFiles(task: SubTask, actionsTaken: TaskAction[]): boolean {
  if (actionsTaken.some((action) => action.tool === 'write' || action.tool === 'edit')) {
    return true;
  }
  return /(implement|fix|modify|edit|build|test)/i.test(task.description);
}

function hasVerificationAction(actionsTaken: TaskAction[]): boolean {
  return collectVerificationEvidence(actionsTaken).length > 0;
}

function collectVerificationEvidence(actionsTaken: TaskAction[]): string[] {
  let sawMutation = false;
  const evidence: string[] = [];
  for (const action of actionsTaken) {
    if (!action.success) continue;
    if (action.tool === 'write' || action.tool === 'edit') {
      sawMutation = true;
      continue;
    }
    if (action.tool === 'read' && sawMutation) {
      evidence.push(`read:${action.target || '(no target)'}`);
    }
    if (action.tool === 'bash' && /(npm run typecheck|npm test|npm run build|pytest|tsc|eslint|vitest|jest)/i.test(action.target)) {
      evidence.push(`bash:${action.target}`);
    }
  }
  return Array.from(new Set(evidence));
}
function collectChangedFilesFromActions(actionsTaken: TaskAction[]): string[] {
  return Array.from(new Set(
    actionsTaken
      .filter((action) => action.success && (action.tool === 'write' || action.tool === 'edit'))
      .map((action) => action.target)
      .filter(Boolean)
  ));
}
function isPlanSafeForParallel(plan: GoalPlan): boolean {
  return !plan.subTasks.some((task) =>
    /(edit|write|modify|fix|implement|install|build|test)/i.test(task.description)
  );
}

function createGoalStopError(signal: GoalStopSignal): Error {
  const verb = signal.action === 'pause' ? 'paused' : 'stopped';
  return new Error(signal.reason || `Goal execution ${verb} by ${signal.action} request`);
}

function checkForGoalStop(shouldStop?: GoalStopChecker): void {
  const signal = shouldStop?.();
  if (signal) {
    throw createGoalStopError(signal);
  }
}

function taskLikelyMutatesProject(description: string): boolean {
  return /(edit|write|modify|fix|implement|install|build|test|refactor|create|delete|rename|update)/i.test(description);
}

function taskLooksLikeVerification(description: string): boolean {
  return /(verify|validation|validate|test|typecheck|build|lint|review|check)/i.test(description);
}

function defaultGoalPlan(goal: Goal): GoalPlan {
  return {
    goal: goal.description,
    subTasks: [
      {
        id: 'task_1',
        description: `Inspect the current project state and identify the concrete files or commands needed for: ${goal.description}`,
        dependencies: [],
        estimatedComplexity: 'medium',
      },
      {
        id: 'task_2',
        description: `Implement the requested changes for: ${goal.description}`,
        dependencies: ['task_1'],
        estimatedComplexity: 'high',
      },
      {
        id: 'task_3',
        description: 'Run relevant validation, summarize changes, and report any remaining risks.',
        dependencies: ['task_2'],
        estimatedComplexity: 'low',
      },
    ],
    estimatedTime: 30,
    parallelExecution: false,
  };
}

function normalizeGoalPlan(goal: Goal, plan: GoalPlan): GoalPlan {
  if (!plan.subTasks || !Array.isArray(plan.subTasks) || plan.subTasks.length === 0) {
    throw new Error('Invalid plan structure: missing subTasks array');
  }

  const usedIds = new Set<string>();
  const normalizedSubTasks = plan.subTasks.map((task, index) => {
    const baseId = typeof task.id === 'string' && task.id.trim() ? task.id.trim() : `task_${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}_${suffix++}`;
    }
    usedIds.add(id);

    return {
      id,
      description: (task.description || `Execute part ${index + 1} of: ${goal.description}`).trim(),
      dependencies: Array.isArray(task.dependencies) ? task.dependencies.filter((dep) => typeof dep === 'string' && dep.trim()) : [],
      estimatedComplexity: task.estimatedComplexity || 'medium' as const,
    };
  });

  const validIds = new Set(normalizedSubTasks.map((task) => task.id));
  const rewrittenSubTasks = normalizedSubTasks.map((task) => ({
    ...task,
    dependencies: Array.from(new Set(task.dependencies.filter((dep) => dep !== task.id && validIds.has(dep)))),
  }));

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(rewrittenSubTasks.map((task) => [task.id, task]));

  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) {
      throw new Error(`Invalid plan structure: cyclic dependency detected at ${taskId}`);
    }
    visiting.add(taskId);
    const task = byId.get(taskId);
    for (const dep of task?.dependencies || []) {
      visit(dep);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of rewrittenSubTasks) {
    visit(task.id);
  }

  const needsVerification = rewrittenSubTasks.some((task) => taskLikelyMutatesProject(task.description));
  const hasVerificationTask = rewrittenSubTasks.some((task) => taskLooksLikeVerification(task.description));

  if (needsVerification && !hasVerificationTask) {
    const lastTaskId = rewrittenSubTasks[rewrittenSubTasks.length - 1]?.id;
    rewrittenSubTasks.push({
      id: `task_${rewrittenSubTasks.length + 1}`,
      description: 'Run relevant validation, inspect changed files if needed, and summarize any remaining risks.',
      dependencies: lastTaskId ? [lastTaskId] : [],
      estimatedComplexity: 'low',
    });
  }

  const normalizedPlan: GoalPlan = {
    goal: plan.goal || goal.description,
    estimatedTime: Number.isFinite(plan.estimatedTime) ? plan.estimatedTime : 30,
    parallelExecution: !!plan.parallelExecution,
    subTasks: rewrittenSubTasks,
  };

  if (!isPlanSafeForParallel(normalizedPlan)) {
    normalizedPlan.parallelExecution = false;
  }

  return normalizedPlan;
}

async function generateReliableGoalPlan(
  goal: Goal,
  callLLM: (prompt: string) => Promise<string>,
  context?: { files?: string[]; projectInfo?: string }
): Promise<GoalPlan> {
  const contextInfo = context?.files?.length
    ? `\n\nProject files:\n${context.files.slice(0, 80).join('\n')}`
    : '';
  const projectInfo = context?.projectInfo
    ? `\n\nProject info:\n${context.projectInfo}`
    : '';

  const prompt = `You are a senior software execution planner. Create a concrete, tool-executable plan for this goal.

Goal: ${goal.description}
${contextInfo}
${projectInfo}

Return valid JSON only:
{
  "goal": "short goal summary",
  "subTasks": [
    {
      "id": "task_1",
      "description": "specific executable task",
      "dependencies": [],
      "estimatedComplexity": "low|medium|high"
    }
  ],
  "estimatedTime": 30,
  "parallelExecution": false
}

Rules:
1. Make each subtask concrete, verifiable, and small enough to execute with read/write/edit/bash tools.
2. Preserve dependency order. Do not mark tasks parallel unless they are truly independent.
3. Avoid vague tasks such as "analyze the goal" unless analysis produces a concrete artifact.
4. Include a final verification subtask when code or files may change.
5. Set "parallelExecution" to false whenever any subtask may read or write files, run build/test commands, install dependencies, or affect shared project state.
6. Return JSON only, with no markdown.`;

  try {
    const response = await retryAsync(() => callLLM(prompt), 3, 'generate reliable goal plan');
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Failed to parse plan JSON from LLM response');

    const plan = JSON.parse(jsonMatch[0]) as GoalPlan;
    return normalizeGoalPlan(goal, plan);
  } catch (err: any) {
    console.error('[GoalExecutor] Failed to generate reliable plan:', err);
    return defaultGoalPlan(goal);
  }
}

async function executeReliableSubTask(
  task: SubTask,
  goal: Goal,
  callLLM: (prompt: string) => Promise<string>,
  executeTool: (toolName: string, args: string) => Promise<string>,
  onProgress?: (progress: number) => void,
  onToolCall?: (toolName: string, target: string, result?: string, success?: boolean) => void,
  shouldStop?: GoalStopChecker
): Promise<string> {
  const result = await executeReliableSubTaskDetailed(task, goal, callLLM, executeTool, onProgress, onToolCall, shouldStop);
  return result.summary;
}

async function executeReliableSubTaskDetailed(
  task: SubTask,
  goal: Goal,
  callLLM: (prompt: string) => Promise<string>,
  executeTool: (toolName: string, args: string) => Promise<string>,
  onProgress?: (progress: number) => void,
  onToolCall?: (toolName: string, target: string, result?: string, success?: boolean) => void,
  shouldStop?: GoalStopChecker
): Promise<TaskExecutionResult> {
  const previousResults = goal.subTasks
    .filter((t) => t.status === 'completed' && task.dependencies.includes(t.id))
    .map((t) => `[${t.description}]: ${t.result}`)
    .join('\n\n');

  const systemPrompt = `You are an execution agent inside a Windows Electron coding workspace.

Goal: ${goal.description}

Available XML tools:
<read><file_path>absolute path</file_path></read>
<write><file_path>absolute path</file_path><content>complete file content</content></write>
<edit><file_path>absolute path</file_path><old_str>exact existing text</old_str><new_str>replacement text</new_str></edit>
<bash><command>PowerShell command</command></bash>

Rules:
1. Use one tool call per response, then wait for the tool result.
2. Use absolute paths for file operations.
3. Read before editing unless the exact current content is already known.
4. After write/edit, verify with read or an appropriate command.
5. If a tool fails, change strategy; do not repeat the same failing call.
6. Stop calling tools when the task is complete and return a concise completion summary.
7. Avoid destructive commands unless the user explicitly requested them.`;

  const taskPrompt = `Current task: ${task.description}${previousResults ? `\n\nCompleted prerequisites:\n${previousResults}` : ''}`;
  const conversationHistory: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: taskPrompt },
  ];
  const actionsTaken: TaskAction[] = [];
  const recentSignatures: string[] = [];
  const toolExecState = createToolExecState();
  let verificationReminderCount = 0;
  const maxSteps = 30;
  let finalAssistantResponse = '';

  for (let step = 0; step < maxSteps; step++) {
    checkForGoalStop(shouldStop);
    const response = await retryAsync(
      () => callLLM(JSON.stringify(conversationHistory)),
      3,
      `LLM step for ${task.id}`
    );
    finalAssistantResponse = response;
    conversationHistory.push({ role: 'assistant', content: response });

    const toolCalls = parseToolCalls(response);
    if (toolCalls.length === 0) {
      if (taskTouchesFiles(task, actionsTaken) && !hasVerificationAction(actionsTaken) && verificationReminderCount < 3) {
        verificationReminderCount++;
        conversationHistory.push({ role: 'user', content: 'The task changed or may have changed files, but no verification has been run yet. Run a focused verification command or read back the changed file before summarizing completion.' });
        continue;
      }
      onProgress?.(100);
      return buildTaskExecutionResult(actionsTaken, goal, task, response || finalAssistantResponse);
    }

    for (const toolCall of toolCalls.slice(0, 1)) {
      checkForGoalStop(shouldStop);
      let target = '';
      let parsed: any = {};
      try {
        parsed = JSON.parse(toolCall.arguments);
        target = parsed.file_path || parsed.filePath || parsed.command || '';
      } catch {
        target = toolCall.arguments;
      }

      const signature = `${toolCall.name}:${toolCall.arguments}`;
      recentSignatures.push(signature);
      if (recentSignatures.length > 8) recentSignatures.shift();
      const duplicateCount = recentSignatures.filter((item) => item === signature).length;
      if (duplicateCount >= 3) {
        throw new Error(`Repeated identical tool call detected for ${toolCall.name}. Last target: ${target}`);
      }

      onToolCall?.(toolCall.name, target);
      const toolResult = await executeTool(toolCall.name, toolCall.arguments);
      const success = !isToolError(toolResult);
      onToolCall?.(toolCall.name, target, toolResult.substring(0, 300), success);

      actionsTaken.push({
        tool: toolCall.name,
        success,
        target,
        content: parsed.content,
        oldStr: parsed.old_str || parsed.oldStr,
        newStr: parsed.new_str || parsed.newStr,
      });

      const processed = processToolResult(toolExecState, toolCall, toolResult);
      const feedback = success
        ? `Tool ${toolCall.name} result:\n${processed.result}`
        : `Tool ${toolCall.name} failed:\n${processed.result}\n\nRecover by changing strategy. Do not repeat the same call.`;
      conversationHistory.push({ role: 'user', content: feedback });
      onProgress?.(Math.min(95, Math.round(((step + 1) / maxSteps) * 100)));

      if (processed.shouldBreak) {
        onProgress?.(100);
        return buildTaskExecutionResult(actionsTaken, goal, task, finalAssistantResponse);
      }
    }
  }

  onProgress?.(100);
  return buildTaskExecutionResult(actionsTaken, goal, task, finalAssistantResponse);
}

function buildStructuredTaskReport(
  actionsTaken: TaskAction[],
  goal: Goal,
  task: SubTask,
  finalAssistantResponse: string
): string {
  if (actionsTaken.length === 0) {
    return finalAssistantResponse || 'No tool actions were needed for this task.';
  }

  const lines = [
    `Task completed: ${task.description}`,
    `Goal: ${goal.description}`,
    '',
    'Actions:',
    ...actionsTaken.map((action) => `- ${action.tool} ${action.success ? 'succeeded' : 'failed'}: ${action.target || '(no target)'}`),
  ];

  const changedFiles = collectChangedFilesFromActions(actionsTaken);
  if (changedFiles.length > 0) {
    lines.push('', 'Changed files:');
    lines.push(...changedFiles.map((filePath) => `- ${filePath}`));
  }

  if (finalAssistantResponse) {
    lines.push('', 'Final assistant summary:', finalAssistantResponse);
  }

  return lines.join('\n');
}

function buildTaskExecutionResult(
  actionsTaken: TaskAction[],
  goal: Goal,
  task: SubTask,
  finalAssistantResponse: string
): TaskExecutionResult {
  const changedFiles = collectChangedFilesFromActions(actionsTaken);
  const verificationEvidence = collectVerificationEvidence(actionsTaken);

  return {
    summary: buildStructuredTaskReport(actionsTaken, goal, task, finalAssistantResponse),
    actionsTaken: [...actionsTaken],
    changedFiles,
    verified: verificationEvidence.length > 0,
    verificationEvidence,
    finalAssistantResponse,
  };
}

function extractChangedFiles(result: string): string[] {
  const files = new Set<string>();
  const filePathRegex = /`([A-Za-z]:[\\\/][^`]+\.[a-zA-Z]{1,10})`/g;
  let match: RegExpExecArray | null;
  while ((match = filePathRegex.exec(result)) !== null) {
    files.add(match[1]);
  }
  return Array.from(files);
}

function actionsTakenFromResult(result: string): TaskAction[] {
  return extractChangedFiles(result).map((filePath) => ({
    tool: 'write',
    success: true,
    target: filePath,
  }));
}

/**
 * Goal Executor class - manages the execution of goals with multiple agents
 */
export class GoalExecutor {
  private goals: Map<string, Goal> = new Map();
  private agents: Map<string, Agent> = new Map();
  private eventHandlers: GoalEventHandler[] = [];
  private callLLM: (prompt: string) => Promise<string>;
  private executeTool: (toolName: string, args: string) => Promise<string>;
  private maxConcurrentAgents: number;
  private shouldStop?: GoalStopChecker;

  constructor(
    callLLM: (prompt: string) => Promise<string>,
    executeTool: (toolName: string, args: string) => Promise<string>,
    maxConcurrentAgents: number = 3,
    shouldStop?: GoalStopChecker
  ) {
    this.callLLM = callLLM;
    this.executeTool = executeTool;
    this.maxConcurrentAgents = maxConcurrentAgents;
    this.shouldStop = shouldStop;
    
    // Initialize agents
    for (let i = 0; i < maxConcurrentAgents; i++) {
      const agentId = `agent_${i + 1}`;
      this.agents.set(agentId, {
        id: agentId,
        name: `Agent ${i + 1}`,
        status: 'idle',
        capabilities: ['read', 'write', 'edit', 'bash'],
      });
    }
  }

  /**
   * Register an event handler
   */
  onEvent(handler: GoalEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit an event
   */
  private emit(event: GoalEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[GoalExecutor] Event handler error:', err);
      }
    }
  }

  /**
   * Get an idle agent
   */
  private getIdleAgent(): Agent | null {
    for (const agent of this.agents.values()) {
      if (agent.status === 'idle') {
        return agent;
      }
    }
    return null;
  }

  /**
   * Execute a goal
   */
  async executeGoal(
    description: string,
    context?: { files?: string[]; projectInfo?: string }
  ): Promise<Goal> {
    // Create goal
    const goal = createGoal(description);
    this.goals.set(goal.id, goal);
    this.emit({ type: 'goal_created', goal });

    try {
      checkForGoalStop(this.shouldStop);
      // Update status to planning
      goal.status = 'planning';
      goal.updatedAt = Date.now();
      this.emit({ type: 'goal_planning', goalId: goal.id });

      // Generate plan
      const plan = await generateGoalPlan(goal, this.callLLM, context);
      this.emit({ type: 'goal_plan_created', goalId: goal.id, plan });

      // Create sub-tasks from plan
      goal.subTasks = plan.subTasks.map(task => ({
        id: task.id,
        goalId: goal.id,
        description: task.description,
        status: 'pending',
        dependencies: task.dependencies,
        attempts: 0,
      }));

      // Update status to executing
      goal.status = 'executing';
      goal.updatedAt = Date.now();
      checkForGoalStop(this.shouldStop);

      // Execute sub-tasks
      const safeParallel = plan.parallelExecution && isPlanSafeForParallel(plan);
      if (safeParallel) {
        await this.executeSubTasksParallel(goal);
      } else {
        await this.executeSubTasksSequential(goal);
      }

      // Aggregate results
      const results = goal.subTasks
        .filter(t => t.status === 'completed')
        .map(t => `[${t.description}]:\n${t.result}`)
        .join('\n\n---\n\n');

      goal.result = `Goal completed successfully.\n\n${results}`;
      goal.status = 'completed';
      goal.updatedAt = Date.now();
      this.emit({ type: 'goal_completed', goalId: goal.id, result: goal.result });

      return goal;
    } catch (err: any) {
      const stoppedByControl = /Goal execution (paused|stopped)|request/i.test(err?.message || '');
      goal.status = stoppedByControl ? 'pending' : 'failed';
      goal.error = err.message;
      goal.updatedAt = Date.now();
      this.emit({ type: 'goal_failed', goalId: goal.id, error: err.message });
      return goal;
    }
  }

  /**
   * Resume an existing goal snapshot without discarding completed sub-tasks.
   */
  async resumeGoal(existingGoal: Goal): Promise<Goal> {
    const goal: Goal = {
      ...existingGoal,
      status: 'executing',
      error: undefined,
      updatedAt: Date.now(),
      subTasks: (existingGoal.subTasks || []).map((task) => ({
        ...task,
        status: task.status === 'completed' ? 'completed' : 'pending',
        error: undefined,
        progress: task.status === 'completed' ? 100 : 0,
      })),
    };
    this.goals.set(goal.id, goal);
    this.emit({ type: 'goal_created', goal });

    try {
      checkForGoalStop(this.shouldStop);
      if (goal.subTasks.length === 0) {
        const plan = await generateGoalPlan(goal, this.callLLM);
        this.emit({ type: 'goal_plan_created', goalId: goal.id, plan });
        goal.subTasks = plan.subTasks.map(task => ({
          id: task.id,
          goalId: goal.id,
          description: task.description,
          status: 'pending',
          dependencies: task.dependencies,
          attempts: 0,
        }));
      }

      const hasIncompleteTasks = goal.subTasks.some((task) => task.status !== 'completed');
      if (hasIncompleteTasks) {
        checkForGoalStop(this.shouldStop);
        // Check if we can run in parallel (no dependencies between incomplete tasks)
        const incompleteTasks = goal.subTasks.filter(t => t.status !== 'completed');
        const hasDependencies = incompleteTasks.some(t => t.dependencies.length > 0);
        const canParallel = !hasDependencies &&
          incompleteTasks.length > 1 &&
          this.maxConcurrentAgents > 1 &&
          isPlanSafeForParallel({
            goal: goal.description,
            subTasks: incompleteTasks.map((task) => ({
              id: task.id,
              description: task.description,
              dependencies: task.dependencies,
              estimatedComplexity: 'medium' as const,
            })),
            estimatedTime: 0,
            parallelExecution: true,
          });

        if (canParallel) {
          console.log(`[GoalExecutor] Resuming with parallel execution (${incompleteTasks.length} tasks, ${this.maxConcurrentAgents} agents)`);
          await this.executeSubTasksParallel(goal);
        } else {
          await this.executeSubTasksSequential(goal);
        }
      }

      const results = goal.subTasks
        .filter(t => t.status === 'completed')
        .map(t => `[${t.description}]:\n${t.result}`)
        .join('\n\n---\n\n');

      goal.result = `Goal completed successfully.\n\n${results}`;
      goal.status = 'completed';
      goal.updatedAt = Date.now();
      this.emit({ type: 'goal_completed', goalId: goal.id, result: goal.result });
      return goal;
    } catch (err: any) {
      const stoppedByControl = /Goal execution (paused|stopped)|request/i.test(err?.message || '');
      goal.status = stoppedByControl ? 'pending' : 'failed';
      goal.error = err.message;
      goal.updatedAt = Date.now();
      this.emit({ type: 'goal_failed', goalId: goal.id, error: err.message });
      return goal;
    }
  }

  /**
   * Execute sub-tasks in parallel when dependencies allow it.
   */
  private async executeSubTasksParallel(goal: Goal): Promise<void> {
    const completedTasks = new Set<string>(
      goal.subTasks.filter((task) => task.status === 'completed').map((task) => task.id)
    );
    const executingTasks = new Map<string, Promise<void>>();

    while (completedTasks.size < goal.subTasks.length) {
      checkForGoalStop(this.shouldStop);
      const readyTasks = goal.subTasks.filter((task) =>
        task.status === 'pending' && task.dependencies.every((dep) => completedTasks.has(dep))
      );

      if (readyTasks.length === 0 && executingTasks.size === 0) {
        const blocked = goal.subTasks.filter((task) => task.status !== 'completed').map((task) => task.description).join(', ');
        throw new Error(`No runnable subtasks remain. Blocked tasks: ${blocked}`);
      }

      for (const task of readyTasks) {
        const agent = this.getIdleAgent();
        if (!agent) break;

        task.status = 'executing';
        task.agentId = agent.id;
        agent.status = 'busy';
        agent.currentTaskId = task.id;

        this.emit({ type: 'subtask_started', goalId: goal.id, subtaskId: task.id, agentId: agent.id });

        const taskPromise = this.executeSingleSubTask(goal, task, agent).finally(() => {
          agent.status = 'idle';
          agent.currentTaskId = undefined;
          executingTasks.delete(task.id);
        });
        executingTasks.set(task.id, taskPromise);
      }

      if (executingTasks.size > 0) {
        await Promise.race(executingTasks.values());
      }

      for (const task of goal.subTasks) {
        if (task.status === 'completed') completedTasks.add(task.id);
      }

      const failedTasks = goal.subTasks.filter((task) => task.status === 'failed');
      if (failedTasks.length > 0 && executingTasks.size === 0) {
        throw new Error(`Subtasks failed: ${failedTasks.map((task) => task.description).join(', ')}`);
      }
    }
  }

  /**
   * Execute sub-tasks sequentially.
   */
  private async executeSubTasksSequential(goal: Goal): Promise<void> {
    for (const task of goal.subTasks) {
      checkForGoalStop(this.shouldStop);
      if (task.status === 'completed') continue;

      const dependenciesSatisfied = task.dependencies.every((dep) => {
        const depTask = goal.subTasks.find((candidate) => candidate.id === dep);
        return depTask?.status === 'completed';
      });
      if (!dependenciesSatisfied) {
        throw new Error(`Task dependencies are not completed: ${task.description}`);
      }

      const agent = this.getIdleAgent();
      if (!agent) {
        throw new Error('没有可用的代理');
      }

      task.status = 'executing';
      task.agentId = agent.id;
      agent.status = 'busy';
      agent.currentTaskId = task.id;
      this.emit({ type: 'subtask_started', goalId: goal.id, subtaskId: task.id, agentId: agent.id });

      try {
        await this.executeSingleSubTask(goal, task, agent);
      } finally {
        agent.status = 'idle';
        agent.currentTaskId = undefined;
      }

      if ((task.status as string) === 'failed') {
        throw new Error(`Subtask failed: ${task.description}`);
      }
    }
  }

  /**
   * Execute a single sub-task with retry and progress reporting.
   */
  private async executeSingleSubTask(goal: Goal, task: SubTask, agent: Agent): Promise<void> {
    const maxAttempts = 3;
    const baseDescription = task.description;
    let lastError = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      task.attempts = attempt;
      task.status = 'executing';
      task.error = undefined;
      task.progress = attempt === 1 ? task.progress : 0;
      task.description = attempt === 1
        ? baseDescription
        : `${baseDescription}\n\nPrevious attempt failed: ${lastError}\n\nRecovery strategy:\n${buildRetryHint(lastError, attempt)}`;

      try {
        if (!task.recentTools) task.recentTools = [];
        const execution = await executeReliableSubTaskDetailed(
          task,
          goal,
          this.callLLM,
          this.executeTool,
          (progress) => {
            task.progress = progress;
            this.emit({ type: 'subtask_progress', goalId: goal.id, subtaskId: task.id, progress });
          },
          (toolName, target, resultPreview, success) => {
            if (resultPreview === undefined) {
              task.currentTool = { name: toolName, target, startedAt: Date.now() };
            } else {
              task.currentTool = undefined;
              task.recentTools!.push({ name: toolName, target, success: !!success, at: Date.now() });
              if (task.recentTools!.length > 8) task.recentTools!.shift();
            }
            this.emit({ type: 'subtask_progress', goalId: goal.id, subtaskId: task.id, progress: task.progress || 0 });
          },
          this.shouldStop
        );

        task.description = baseDescription;
        task.status = 'completed';
        task.result = execution.summary;
        task.progress = 100;
        task.filesChanged = execution.changedFiles.length > 0
          ? execution.changedFiles
          : extractChangedFiles(execution.summary);
        task.verified = execution.verified;
        task.verificationEvidence = execution.verificationEvidence;
        this.emit({ type: 'subtask_completed', goalId: goal.id, subtaskId: task.id, result: execution.summary });
        return;
      } catch (err: any) {
        lastError = err.message || String(err);
        console.warn(`[GoalExecutor] Subtask ${task.id} failed (${attempt}/${maxAttempts}):`, lastError);

        if (attempt < maxAttempts) {
          this.emit({
            type: 'subtask_progress',
            goalId: goal.id,
            subtaskId: task.id,
            progress: Math.min(95, Math.max(task.progress || 0, 10)),
          });
          await sleep(700 * attempt);
          continue;
        }

        task.description = baseDescription;
        task.status = 'failed';
        task.error = lastError;
        task.currentTool = undefined;
        this.emit({ type: 'subtask_failed', goalId: goal.id, subtaskId: task.id, error: lastError });
      }
    }
  }
  /**
   * Get goal by ID
   */
  getGoal(goalId: string): Goal | undefined {
    return this.goals.get(goalId);
  }

  /**
   * Get all goals
   */
  getAllGoals(): Goal[] {
    return Array.from(this.goals.values());
  }

  /**
   * Get agent status
   */
  getAgentStatus(): Agent[] {
    return Array.from(this.agents.values());
  }
}

