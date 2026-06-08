import { app, BrowserWindow, dialog, IpcMainEvent, ipcMain, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify, TextDecoder } from 'util';
import type {
  ActiveGoalDispatchEvent,
  ApiProxyRequest,
  ApiProxyStreamRequest,
  FileDialogOptions,
  FileEntry,
  GoalQueueDispatchEvent,
  GoalQueueDispatchCandidate,
  GoalQueueEvent,
  GoalQueueItem,
  GoalRunControl,
  GoalRunControlAction,
  GoalRunEventPatch,
  GoalRunExecutePayload,
  GoalRunExecuteResult,
  GoalRunHeartbeatPatch,
  GoalRunStartPayload,
  McpServerConfig,
  McpTool,
  ToolExecutionResult,
} from '../shared/ipc-types';
import {
  createGoalStateEvent,
  normalizeGoalQueueItem,
  type ActiveGoalSnapshotState,
  type GoalQueueItemState,
} from './goal-state';
import { buildChatCompletionsUrl } from '../shared/api-endpoints';
import {
  getAppStatePath,
  readJsonState,
  writeJsonState,
} from './state-store';
import { GoalExecutor } from '../shared/goal-executor';
import {
  defaultCache,
  apiCache,
  appStateCache,
  fileContentCache,
  directoryCache,
} from './cache';

const execAsync = promisify(exec);
const APP_USER_MODEL_ID = 'com.tzynb112.pianoagentdesktop';

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// --- Fuzzy Edit Engine ---
interface FuzzyEditResult {
  success: boolean;
  content?: string;
  method?: string;
  similarity?: number;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  return 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length);
}

function fuzzyEdit(content: string, oldStr: string, newStr: string): FuzzyEditResult {
  // 1. Normalized-whitespace line match
  const oldLines = oldStr.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const contentLines = content.split('\n');
  if (oldLines.length > 0) {
    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      let match = true;
      for (let j = 0; j < oldLines.length; j++) {
        if (contentLines[i + j].trim() !== oldLines[j]) { match = false; break; }
      }
      if (match) {
        let charStart = 0;
        for (let k = 0; k < i; k++) charStart += contentLines[k].length + 1;
        let charEnd = charStart;
        for (let k = i; k < i + oldLines.length && k < contentLines.length; k++) charEnd += contentLines[k].length + 1;
        const indent = contentLines[i]?.match(/^(\s*)/)?.[1] || '';
        const indentedNew = newStr.split('\n').map((line, idx) => idx === 0 ? line : indent + line).join('\n');
        return { success: true, content: content.substring(0, charStart) + indentedNew + content.substring(charEnd), method: 'line-fuzzy', similarity: 0.95 };
      }
    }
  }

  // 2. Sliding-window similarity match
  if (oldStr.length > 0 && oldStr.length <= content.length) {
    let bestStart = -1, bestScore = 0;
    const step = Math.max(1, Math.floor(oldStr.length / 10));
    for (let i = 0; i <= content.length - oldStr.length; i += step) {
      const score = stringSimilarity(content.substring(i, i + oldStr.length), oldStr);
      if (score > bestScore) { bestScore = score; bestStart = i; }
    }
    // Fine-grained search around the best coarse match to avoid missing due to step size
    if (bestStart >= 0 && bestScore >= 0.6) {
      const refineStart = Math.max(0, bestStart - step);
      const refineEnd = Math.min(content.length - oldStr.length, bestStart + step);
      for (let i = refineStart; i <= refineEnd; i++) {
        const score = stringSimilarity(content.substring(i, i + oldStr.length), oldStr);
        if (score > bestScore) { bestScore = score; bestStart = i; }
      }
    }
    if (bestStart >= 0 && bestScore >= 0.85) {
      return { success: true, content: content.substring(0, bestStart) + newStr + content.substring(bestStart + oldStr.length), method: 'similarity', similarity: bestScore };
    }
  }

  return { success: false };
}

const GOAL_QUEUE_STATE_KEY = 'goal-queue';
const ACTIVE_GOAL_STATE_KEY = 'active-goal';
const GOAL_RUNS_STATE_KEY = 'goal-runs';
const GOAL_RUNNING_LEASE_MS = 90_000;
const GOAL_STATE_WATCHDOG_MS = Math.max(15_000, Math.floor(GOAL_RUNNING_LEASE_MS / 3));
const GOAL_DISPATCH_RETRY_MS = 15_000;

interface McpClient {
  process: ChildProcess;
  tools: any[];
  pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>;
  stdoutBuffer: string;
}

interface GoalRunState {
  id: string;
  conversationId?: string;
  goalId?: string;
  description?: string;
  workspacePath?: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  updatedAt: number;
  lastHeartbeatAt: number;
  statusNote?: string;
  goalSnapshot?: any;
  agentsSnapshot?: any[];
  events?: GoalRunEventState[];
  control?: GoalRunControl;
  error?: string;
}

interface GoalRunEventState {
  id: string;
  at: number;
  type: string;
  message?: string;
  goalId?: string;
}

const mcpClients = new Map<string, McpClient>();
const activeToolProcesses = new Map<string, ChildProcess>();
const cancelledToolProcessIds = new Set<string>();
let goalStateWatchdog: NodeJS.Timeout | null = null;
let goalDispatchWatchdog: NodeJS.Timeout | null = null;

function recoverInterruptedGoalState(goal: any, now = Date.now()): any {
  if (!goal || (goal.status !== 'planning' && goal.status !== 'executing')) {
    return goal;
  }

  return {
    ...goal,
    status: 'failed',
    error: '主进程检测到执行中断，已保存断点，可继续目标。',
    updatedAt: now,
    subTasks: Array.isArray(goal.subTasks)
      ? goal.subTasks.map((task: any) =>
          task.status === 'executing'
            ? {
                ...task,
                status: 'failed',
                error: task.error || '主进程检测到该子任务中断，可从此处继续。',
              }
            : task
        )
      : goal.subTasks,
  };
}

function recoverGoalQueueState(now = Date.now(), leaseMs = GOAL_RUNNING_LEASE_MS): boolean {
  const queue = readJsonState<GoalQueueItemState[]>(GOAL_QUEUE_STATE_KEY);
  if (!Array.isArray(queue)) return false;

  let changed = false;
  const next = queue.map((item) => {
    if (item.status !== 'running') return item;
    const heartbeatAt = item.meta?.lastHeartbeatAt || item.updatedAt || item.createdAt || 0;
    const isStale = now - heartbeatAt >= leaseMs;
    if (!isStale) return item;

    changed = true;
    const recoveredGoal = recoverInterruptedGoalState(item.goal, now);
    return {
      ...item,
      status: 'failed' as const,
      goal: recoveredGoal,
      updatedAt: now,
      meta: {
        ...(item.meta || {}),
        savedAt: now,
        lastHeartbeatAt: now,
        failureCount: (item.meta?.failureCount || 0) + 1,
        lastDispatchAt: undefined,
        autoResumeEnabled: false,
        nextAutoResumeAt: undefined,
        statusNote: '主进程检测到运行租约超时，已转为可续跑',
      },
      history: [
        ...(item.history || []),
        createGoalStateEvent('recovered', '主进程检测到运行租约超时，已转为可续跑', now),
      ].slice(-12),
    };
  });

  if (changed) {
    writeJsonState(GOAL_QUEUE_STATE_KEY, next);
  }
  return changed;
}

function claimGoalQueueItem(goalId: string, now = Date.now()): GoalQueueItem | null {
  recoverGoalQueueState(now);
  const queue = readJsonState<GoalQueueItemState[]>(GOAL_QUEUE_STATE_KEY);
  if (!Array.isArray(queue)) return null;

  let claimed: GoalQueueItemState | null = null;
  const next = queue.map((item) => {
    if (item.id !== goalId) return item;
    if (item.status !== 'queued' && item.status !== 'failed') return item;
    if (!item.goal) return item;

    claimed = {
      ...item,
      status: 'running',
      updatedAt: now,
      meta: {
        ...(item.meta || {}),
        savedAt: now,
        lastHeartbeatAt: now,
        lastDispatchAt: undefined,
        autoResumeEnabled: false,
        nextAutoResumeAt: undefined,
        statusNote: '自动续跑任务运行中',
      },
      history: [
        ...(item.history || []),
        createGoalStateEvent('auto_resume', '自动续跑任务运行中', now),
      ].slice(-12),
    };
    return claimed;
  });

  if (!claimed) return null;
  writeJsonState(GOAL_QUEUE_STATE_KEY, next);
  return normalizeGoalQueueItem(claimed);
}

function heartbeatGoalQueueItem(goalId: string, now = Date.now()): GoalQueueItem | null {
  const queue = readJsonState<GoalQueueItemState[]>(GOAL_QUEUE_STATE_KEY);
  if (!Array.isArray(queue)) return null;

  let touched: GoalQueueItemState | null = null;
  const next = queue.map((item) => {
    if (item.id !== goalId || item.status !== 'running') return item;
    touched = {
      ...item,
      updatedAt: now,
      meta: {
        ...(item.meta || {}),
        savedAt: now,
        lastHeartbeatAt: now,
        statusNote: item.meta?.statusNote || '自动续跑任务运行中',
      },
    };
    return touched;
  });

  if (!touched) return null;
  writeJsonState(GOAL_QUEUE_STATE_KEY, next);
  return normalizeGoalQueueItem(touched);
}

function finishGoalQueueItem(
  goalId: string,
  status: 'completed' | 'failed',
  note: string,
  options: { targetGoalId?: string; failureIncrement?: number } = {},
  now = Date.now()
): GoalQueueItem | null {
  const queue = readJsonState<GoalQueueItemState[]>(GOAL_QUEUE_STATE_KEY);
  if (!Array.isArray(queue)) return null;

  let finished: GoalQueueItemState | null = null;
  const next = queue.map((item) => {
    if (item.id !== goalId) return item;
    const failureCount = (item.meta?.failureCount || 0) + (status === 'failed' ? (options.failureIncrement ?? 1) : 0);
    finished = {
      ...item,
      status,
      updatedAt: now,
      meta: {
        ...(item.meta || {}),
        savedAt: now,
        lastHeartbeatAt: now,
        failureCount,
        lastDispatchAt: undefined,
        autoResumeEnabled: false,
        nextAutoResumeAt: undefined,
        statusNote: note,
      },
      history: [
        ...(item.history || []),
        createGoalStateEvent(status === 'completed' ? 'completed' : 'failed', note, now),
      ].slice(-12),
    };
    return finished;
  });

  if (!finished) return null;
  writeJsonState(GOAL_QUEUE_STATE_KEY, next);
  return normalizeGoalQueueItem(finished);
}

function markGoalQueueDispatchAttempt(goalId: string, now = Date.now()): void {
  const queue = readJsonState<GoalQueueItemState[]>(GOAL_QUEUE_STATE_KEY);
  if (!Array.isArray(queue)) return;

  let changed = false;
  const next = queue.map((item) => {
    if (item.id !== goalId) return item;
    changed = true;
    return {
      ...item,
      updatedAt: now,
      meta: {
        ...(item.meta || {}),
        savedAt: now,
        lastDispatchAt: now,
      },
    };
  });

  if (changed) {
    writeJsonState(GOAL_QUEUE_STATE_KEY, next);
  }
}

function collectDueGoalQueueDispatches(now = Date.now()): GoalQueueDispatchCandidate[] {
  const queue = readJsonState<GoalQueueItemState[]>(GOAL_QUEUE_STATE_KEY);
  if (!Array.isArray(queue)) return [];

  return queue
    .filter((item) =>
      (item.status === 'queued' || item.status === 'failed') &&
      !!item.goal &&
      !!item.meta?.autoResumeEnabled &&
      !!item.meta?.nextAutoResumeAt &&
      item.meta.nextAutoResumeAt <= now &&
      (!item.meta.lastDispatchAt || now - item.meta.lastDispatchAt >= GOAL_DISPATCH_RETRY_MS)
    )
    .sort((a, b) => (a.meta?.nextAutoResumeAt || 0) - (b.meta?.nextAutoResumeAt || 0))
    .map((item) => ({
      goalId: item.id,
      conversationId: item.conversationId,
    }));
}

function markActiveGoalDispatchAttempt(now = Date.now()): void {
  const snapshot = readJsonState<ActiveGoalSnapshotState>(ACTIVE_GOAL_STATE_KEY);
  if (!snapshot?.goal) return;

  writeJsonState(ACTIVE_GOAL_STATE_KEY, {
    ...snapshot,
    savedAt: now,
    meta: {
      ...(snapshot.meta || {}),
      savedAt: now,
      lastDispatchAt: now,
    },
  });
}

function collectDueActiveGoalDispatch(now = Date.now()): { goalId?: string; conversationId?: string } | null {
  const snapshot = readJsonState<ActiveGoalSnapshotState>(ACTIVE_GOAL_STATE_KEY);
  if (
    !snapshot?.goal ||
    !snapshot.conversationId ||
    snapshot.goal.status === 'completed' ||
    snapshot.goal.status === 'executing' ||
    !snapshot.meta?.autoResumeEnabled ||
    !snapshot.meta?.nextAutoResumeAt ||
    snapshot.meta.nextAutoResumeAt > now ||
    (!!snapshot.meta.lastDispatchAt && now - snapshot.meta.lastDispatchAt < GOAL_DISPATCH_RETRY_MS)
  ) {
    return null;
  }

  return {
    goalId: snapshot.goal.id,
    conversationId: snapshot.conversationId,
  };
}

function recoverActiveGoalState(now = Date.now()): boolean {
  const snapshot = readJsonState<ActiveGoalSnapshotState>(ACTIVE_GOAL_STATE_KEY);
  if (!snapshot?.goal) return false;

  const recoveredGoal = recoverInterruptedGoalState(snapshot.goal, now);
  if (recoveredGoal === snapshot.goal) return false;

  writeJsonState(ACTIVE_GOAL_STATE_KEY, {
    ...snapshot,
    goal: recoveredGoal,
    meta: {
      ...(snapshot.meta || {}),
      savedAt: now,
      lastHeartbeatAt: now,
      failureCount: (snapshot.meta?.failureCount || 0) + 1,
      lastDispatchAt: undefined,
      autoResumeEnabled: false,
      nextAutoResumeAt: undefined,
      statusNote: '主进程检测到活动目标中断，已保存断点',
    },
  });
  return true;
}

function readGoalRunsState(): GoalRunState[] {
  const runs = readJsonState<GoalRunState[]>(GOAL_RUNS_STATE_KEY);
  return Array.isArray(runs) ? runs : [];
}

function readLatestRunningGoalRunState(now = Date.now(), leaseMs = GOAL_RUNNING_LEASE_MS): GoalRunState | null {
  recoverGoalRunState(now, leaseMs);
  const runs = readGoalRunsState();
  return runs
    .filter((run) => run.status === 'running')
    .sort((a, b) => (b.lastHeartbeatAt || b.updatedAt || b.startedAt) - (a.lastHeartbeatAt || a.updatedAt || a.startedAt))[0] || null;
}

function writeGoalRunsState(runs: GoalRunState[]): void {
  writeJsonState(GOAL_RUNS_STATE_KEY, runs.slice(0, 50));
}

function broadcastGoalRunState(run: GoalRunState | null): void {
  if (!run || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('goal-run-state-update', { run });
}

function upsertGoalRunState(run: GoalRunState): GoalRunState {
  const runs = readGoalRunsState();
  const next = [run, ...runs.filter((item) => item.id !== run.id)].slice(0, 50);
  writeGoalRunsState(next);
  return run;
}

function startGoalRunState(payload: GoalRunStartPayload, now = Date.now()): GoalRunState {
  const run: GoalRunState = {
    id: payload.id || `goal_run_${now}_${Math.random().toString(36).slice(2, 8)}`,
    conversationId: payload.conversationId,
    goalId: payload.goalId,
    description: payload.description,
    workspacePath: payload.workspacePath,
    status: 'running',
    startedAt: payload.startedAt || now,
    updatedAt: now,
    lastHeartbeatAt: now,
    statusNote: payload.statusNote || '目标运行已启动',
    goalSnapshot: payload.goalSnapshot,
    agentsSnapshot: payload.agentsSnapshot,
    events: [
      {
        id: `goal_run_event_${now}_${Math.random().toString(36).slice(2, 8)}`,
        at: now,
        type: 'started',
        message: payload.description ? `目标运行已启动: ${payload.description}` : '目标运行已启动',
        goalId: payload.goalId,
      },
    ],
  };
  const saved = upsertGoalRunState(run);
  broadcastGoalRunState(saved);
  return saved;
}

function heartbeatGoalRunState(runId: string, patch: GoalRunHeartbeatPatch = {}, now = Date.now()): GoalRunState | null {
  const runs = readGoalRunsState();
  let touched: GoalRunState | null = null;
  const next = runs.map((run) => {
    if (run.id !== runId || run.status !== 'running') return run;
    touched = {
      ...run,
      id: run.id,
      goalId: patch.goalId || run.goalId,
      description: patch.description || run.description,
      status: 'running',
      updatedAt: now,
      lastHeartbeatAt: now,
      statusNote: patch.statusNote || run.statusNote,
      goalSnapshot: patch.goalSnapshot || run.goalSnapshot,
      agentsSnapshot: patch.agentsSnapshot || run.agentsSnapshot,
    };
    return touched;
  });

  if (!touched) return null;
  writeGoalRunsState(next);
  broadcastGoalRunState(touched);
  return touched;
}

function appendGoalRunEventState(runId: string, event: GoalRunEventPatch, now = Date.now()): GoalRunState | null {
  const runs = readGoalRunsState();
  let updatedRun: GoalRunState | null = null;
  const next = runs.map((run) => {
    if (run.id !== runId || run.status !== 'running') return run;
    const runEvent: GoalRunEventState = {
      id: `goal_run_event_${now}_${Math.random().toString(36).slice(2, 8)}`,
      at: now,
      type: event.type,
      message: event.message,
      goalId: event.goalId || run.goalId,
    };
    updatedRun = {
      ...run,
      goalId: event.goalId || run.goalId,
      description: event.description || run.description,
      updatedAt: now,
      lastHeartbeatAt: now,
      statusNote: event.statusNote || event.message || run.statusNote,
      goalSnapshot: event.goalSnapshot || run.goalSnapshot,
      agentsSnapshot: event.agentsSnapshot || run.agentsSnapshot,
      events: [...(run.events || []), runEvent].slice(-50),
    };
    return updatedRun;
  });

  if (!updatedRun) return null;
  writeGoalRunsState(next);
  broadcastGoalRunState(updatedRun);
  return updatedRun;
}

function finishGoalRunState(runId: string, status: 'completed' | 'failed', error?: string, now = Date.now()): GoalRunState | null {
  const runs = readGoalRunsState();
  let finished: GoalRunState | null = null;
  const next = runs.map((run) => {
    if (run.id !== runId) return run;
    const finalMessage = status === 'completed' ? '目标运行已完成' : (error || '目标执行失败');
    finished = {
      ...run,
      status,
      error,
      updatedAt: now,
      lastHeartbeatAt: now,
      statusNote: finalMessage,
      events: [
        ...(run.events || []),
        {
          id: `goal_run_event_${now}_${Math.random().toString(36).slice(2, 8)}`,
          at: now,
          type: status,
          message: finalMessage,
          goalId: run.goalId,
        },
      ].slice(-50),
    };
    return finished;
  });

  if (!finished) return null;
  writeGoalRunsState(next);
  broadcastGoalRunState(finished);
  return finished;
}

function requestGoalRunControlState(
  runId: string,
  action: GoalRunControlAction,
  reason?: string,
  now = Date.now()
): GoalRunState | null {
  const runs = readGoalRunsState();
  let controlled: GoalRunState | null = null;
  const next = runs.map((run) => {
    if (run.id !== runId || run.status !== 'running') return run;
    controlled = {
      ...run,
      updatedAt: now,
      control: {
        action,
        reason,
        requestedAt: now,
      },
    };
    return controlled;
  });

  if (!controlled) return null;
  writeGoalRunsState(next);
  broadcastGoalRunState(controlled);
  return controlled;
}

function acknowledgeGoalRunControlState(runId: string, now = Date.now()): GoalRunState | null {
  const runs = readGoalRunsState();
  let acknowledged: GoalRunState | null = null;
  const next = runs.map((run) => {
    if (run.id !== runId || !run.control || run.control.acknowledgedAt) return run;
    acknowledged = {
      ...run,
      updatedAt: now,
      control: {
        ...run.control,
        acknowledgedAt: now,
      },
    };
    return acknowledged;
  });

  if (!acknowledged) return null;
  writeGoalRunsState(next);
  broadcastGoalRunState(acknowledged);
  return acknowledged;
}

function readGoalRunControlState(runId: string): GoalRunControl | null {
  const run = readGoalRunsState().find((item) => item.id === runId);
  if (!run || run.status !== 'running' || !run.control || run.control.acknowledgedAt) {
    return null;
  }
  return run.control;
}

function buildRecoveredGoalFromRun(run: GoalRunState, now = Date.now()): any {
  const sourceGoal = run.goalSnapshot || {
    id: run.goalId || `recovered_${run.id}`,
    description: run.description || 'Recovered interrupted goal',
    status: 'failed',
    createdAt: run.startedAt || now,
    updatedAt: now,
    subTasks: [],
  };
  const recoveredGoal = recoverInterruptedGoalState(sourceGoal, now);
  const baseGoal = recoveredGoal === sourceGoal && recoveredGoal.status !== 'failed'
    ? {
        ...recoveredGoal,
        status: 'failed',
        error: run.error || '主进程检测到目标运行心跳超时，已保存断点。',
        updatedAt: now,
      }
    : recoveredGoal;

  return {
    ...baseGoal,
    id: baseGoal.id || run.goalId || `recovered_${run.id}`,
    description: baseGoal.description || run.description || 'Recovered interrupted goal',
    status: 'failed',
    error: baseGoal.error || run.error || '主进程检测到目标运行心跳超时，已保存断点。',
    updatedAt: now,
    subTasks: Array.isArray(baseGoal.subTasks) ? baseGoal.subTasks : [],
  };
}

function recoverActiveGoalFromStaleRun(run: GoalRunState, now = Date.now()): boolean {
  if (!run.goalId && !run.goalSnapshot?.id) return false;
  const snapshot = readJsonState<ActiveGoalSnapshotState>(ACTIVE_GOAL_STATE_KEY);
  const runGoalId = run.goalId || run.goalSnapshot?.id;
  if (!snapshot?.goal || snapshot.goal.id !== runGoalId) return false;

  const failedGoal = buildRecoveredGoalFromRun(
    {
      ...run,
      goalSnapshot: run.goalSnapshot || snapshot.goal,
      goalId: runGoalId,
    },
    now
  );

  writeJsonState(ACTIVE_GOAL_STATE_KEY, {
    ...snapshot,
    goal: failedGoal,
    agents: run.agentsSnapshot || snapshot.agents,
    savedAt: now,
    meta: {
      ...(snapshot.meta || {}),
      savedAt: now,
      lastHeartbeatAt: now,
      failureCount: (snapshot.meta?.failureCount || 0) + 1,
      lastDispatchAt: undefined,
      autoResumeEnabled: false,
      nextAutoResumeAt: undefined,
      statusNote: '主进程检测到目标运行心跳超时，已保存断点',
    },
  });
  return true;
}

function recoverGoalQueueFromStaleRun(run: GoalRunState, now = Date.now()): boolean {
  if (!run.goalId && !run.goalSnapshot?.id) return false;
  const queue = readJsonState<GoalQueueItemState[]>(GOAL_QUEUE_STATE_KEY);
  if (!Array.isArray(queue)) return false;
  const runGoalId = run.goalId || run.goalSnapshot?.id;

  let changed = false;
  const next = queue.map((item) => {
    if (item.id !== runGoalId && item.goal?.id !== runGoalId) return item;
    changed = true;
    const recoveredGoal = buildRecoveredGoalFromRun(
      {
        ...run,
        goalId: runGoalId,
        goalSnapshot: run.goalSnapshot || item.goal,
      },
      now
    );
    return {
      ...item,
      status: 'failed' as const,
      goal: recoveredGoal,
      agents: run.agentsSnapshot || item.agents,
      updatedAt: now,
      meta: {
        ...(item.meta || {}),
        savedAt: now,
        lastHeartbeatAt: now,
        failureCount: (item.meta?.failureCount || 0) + 1,
        lastDispatchAt: undefined,
        autoResumeEnabled: false,
        nextAutoResumeAt: undefined,
        statusNote: '主进程检测到目标运行心跳超时，已转为可续跑',
      },
      history: [
        ...(item.history || []),
        createGoalStateEvent('recovered', '主进程检测到目标运行心跳超时，已转为可续跑', now),
      ].slice(-12),
    };
  });

  if (changed) {
    writeJsonState(GOAL_QUEUE_STATE_KEY, next);
  }
  return changed;
}

function createGoalQueueCheckpointFromStaleRun(run: GoalRunState, now = Date.now()): boolean {
  if ((!run.description && !run.goalSnapshot?.description) || !run.conversationId) return false;
  const queue = readJsonState<GoalQueueItemState[]>(GOAL_QUEUE_STATE_KEY);
  const existingQueue = Array.isArray(queue) ? queue : [];
  const recoveredGoal = buildRecoveredGoalFromRun(run, now);
  const syntheticGoalId = recoveredGoal.id || `recovered_${run.id}`;
  if (existingQueue.some((item) => item.id === syntheticGoalId || item.goal?.id === syntheticGoalId)) {
    return false;
  }

  const checkpoint: GoalQueueItemState = {
    id: syntheticGoalId,
    conversationId: run.conversationId,
    title: (recoveredGoal.description || run.description || 'Recovered interrupted goal').slice(0, 80),
    description: recoveredGoal.description || run.description || 'Recovered interrupted goal',
    status: 'failed',
    createdAt: run.startedAt || now,
    updatedAt: now,
    goal: recoveredGoal,
    agents: run.agentsSnapshot,
    meta: {
      savedAt: now,
      lastHeartbeatAt: now,
      failureCount: 1,
      lastDispatchAt: undefined,
      autoResumeEnabled: false,
      nextAutoResumeAt: undefined,
      statusNote: run.goalSnapshot
        ? '主进程从目标运行快照生成可续跑断点'
        : '主进程检测到目标在规划前中断，已生成可续跑断点',
    },
    history: [
      createGoalStateEvent(
        'recovered',
        run.goalSnapshot
          ? '主进程从目标运行快照生成可续跑断点'
          : '主进程检测到目标在规划前中断，已生成可续跑断点',
        now
      ),
    ],
  };

  writeJsonState(GOAL_QUEUE_STATE_KEY, [checkpoint, ...existingQueue].slice(0, 20));
  return true;
}

function recoverGoalRunState(now = Date.now(), leaseMs = GOAL_RUNNING_LEASE_MS): boolean {
  const runs = readGoalRunsState();
  if (runs.length === 0) return false;

  let changed = false;
  const next = runs.map((run) => {
    if (run.status !== 'running') return run;
    const isStale = now - (run.lastHeartbeatAt || run.updatedAt || run.startedAt) >= leaseMs;
    if (!isStale) return run;
    changed = true;
    const failedRun = {
      ...run,
      status: 'failed' as const,
      updatedAt: now,
      lastHeartbeatAt: now,
      error: '主进程检测到目标运行心跳超时，已标记为失败并保留断点。',
    };
    recoverActiveGoalFromStaleRun(failedRun, now);
    recoverGoalQueueFromStaleRun(failedRun, now);
    createGoalQueueCheckpointFromStaleRun(failedRun, now);
    return {
      ...failedRun,
    };
  });

  if (changed) {
    writeGoalRunsState(next);
  }
  return changed;
}

function recoverPersistentGoalState(reason: string): void {
  try {
    const queueChanged = recoverGoalQueueState();
    const activeChanged = recoverActiveGoalState();
    const runChanged = recoverGoalRunState();
    if (queueChanged || activeChanged || runChanged) {
      console.log(`[GoalState] Persistent goal state recovered (${reason}).`);
    }
  } catch (err: any) {
    console.error(`[GoalState] Recovery failed (${reason}):`, err.message);
  }
}

function startGoalStateWatchdog(): void {
  recoverPersistentGoalState('startup');
  if (goalStateWatchdog) return;
  goalStateWatchdog = setInterval(() => {
    recoverPersistentGoalState('watchdog');
  }, GOAL_STATE_WATCHDOG_MS);
  goalStateWatchdog.unref?.();
}

function stopGoalStateWatchdog(): void {
  if (!goalStateWatchdog) return;
  clearInterval(goalStateWatchdog);
  goalStateWatchdog = null;
}

function dispatchDueGoalQueueItems(reason: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    const dueItems = collectDueGoalQueueDispatches();
    for (const payload of dueItems) {
      markGoalQueueDispatchAttempt(payload.goalId);
      const event: GoalQueueDispatchEvent = {
        ...payload,
        reason,
        at: Date.now(),
      };
      mainWindow.webContents.send('goal-queue-dispatch', event);
    }

    const dueActiveGoal = collectDueActiveGoalDispatch();
    if (dueActiveGoal) {
      markActiveGoalDispatchAttempt();
      const event: ActiveGoalDispatchEvent = {
        ...dueActiveGoal,
        reason,
        at: Date.now(),
      };
      mainWindow.webContents.send('active-goal-dispatch', event);
    }
  } catch (err: any) {
    console.error(`[GoalState] Dispatch failed (${reason}):`, err.message);
  }
}

function startGoalDispatchWatchdog(): void {
  dispatchDueGoalQueueItems('startup');
  if (goalDispatchWatchdog) return;
  goalDispatchWatchdog = setInterval(() => {
    dispatchDueGoalQueueItems('watchdog');
  }, 5_000);
  goalDispatchWatchdog.unref?.();
}

function stopGoalDispatchWatchdog(): void {
  if (!goalDispatchWatchdog) return;
  clearInterval(goalDispatchWatchdog);
  goalDispatchWatchdog = null;
}

async function startMcpServer(server: McpServerConfig): Promise<void> {
  if (mcpClients.has(server.id)) {
    return;
  }

  console.log(`[MCP] Starting server: ${server.name} via ${server.command} ${server.args}`);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (server.env) {
    if (typeof server.env === 'string') {
      const lines = server.env.split('\n');
      for (const line of lines) {
        const idx = line.indexOf('=');
        if (idx !== -1) {
          const k = line.substring(0, idx).trim();
          const v = line.substring(idx + 1).trim();
          if (k) env[k] = v;
        }
      }
    } else {
      for (const [key, value] of Object.entries(server.env)) {
        if (key) env[key] = value;
      }
    }
  }

  const argList: string[] = Array.isArray(server.args)
    ? server.args.filter((arg) => typeof arg === 'string' && arg.trim().length > 0)
    : (() => {
        const matches = server.args.match(/"[^"]+"|[^\s]+/g);
        return matches ? matches.map((m) => m.replace(/"/g, '')) : [];
      })();

  try {
    const child = spawn(server.command, argList, {
      env,
      shell: true,
      windowsHide: true,
    });

    const client: McpClient = {
      process: child,
      tools: [],
      pendingRequests: new Map(),
      stdoutBuffer: '',
    };

    child.stdout?.on('data', (data) => {
      client.stdoutBuffer += data.toString();
      const lines = client.stdoutBuffer.split('\n');
      client.stdoutBuffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        console.log(`[MCP][${server.name}][STDOUT]`, line);
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) {
            const req = client.pendingRequests.get(msg.id.toString());
            if (req) {
              client.pendingRequests.delete(msg.id.toString());
              if (msg.error) {
                req.reject(new Error(msg.error.message || 'JSON-RPC Error'));
              } else {
                req.resolve(msg.result);
              }
            }
          }
        } catch (e: any) {
          console.error(`[MCP][${server.name}] Failed to parse stdout JSON:`, e.message);
        }
      }
    });

    child.stderr?.on('data', (data) => {
      console.error(`[MCP][${server.name}][STDERR]`, data.toString().trim());
    });

    child.on('close', (code) => {
      console.log(`[MCP][${server.name}] Exited with code: ${code}`);
      // Reject all pending requests so Promises don't hang forever
      for (const [id, req] of client.pendingRequests.entries()) {
        req.reject(new Error(`MCP server "${server.name}" exited (code ${code}) before responding to request ${id}`));
      }
      client.pendingRequests.clear();
      mcpClients.delete(server.id);
    });

    const MCP_REQUEST_TIMEOUT_MS = 30_000;

    const sendRequest = (method: string, params: any = {}): Promise<any> => {
      return new Promise((resolve, reject) => {
        const id = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        const timer = setTimeout(() => {
          client.pendingRequests.delete(id);
          reject(new Error(`MCP request "${method}" timed out after ${MCP_REQUEST_TIMEOUT_MS}ms`));
        }, MCP_REQUEST_TIMEOUT_MS);

        client.pendingRequests.set(id, {
          resolve: (val: any) => { clearTimeout(timer); resolve(val); },
          reject: (err: any) => { clearTimeout(timer); reject(err); },
        });

        const req = {
          jsonrpc: '2.0',
          id,
          method,
          params,
        };
        child.stdin?.write(JSON.stringify(req) + '\n');
      });
    };

    console.log(`[MCP][${server.name}] Initializing...`);
    const initResult = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'PianoAgent', version: '1.0.0' }
    });
    
    const initializedNotification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    child.stdin?.write(JSON.stringify(initializedNotification) + '\n');
    console.log(`[MCP][${server.name}] Initialized! Handshake result:`, initResult);

    const toolsResult = await sendRequest('tools/list', {});
    client.tools = toolsResult.tools || [];
    mcpClients.set(server.id, client);  // Register only after full initialization
    console.log(`[MCP][${server.name}] Loaded tools:`, client.tools.map((t: any) => t.name));

  } catch (err: any) {
    console.error(`[MCP] Failed to start server ${server.name}:`, err.message);
    mcpClients.delete(server.id);
  }
}

function stopMcpServer(id: string): void {
  const client = mcpClients.get(id);
  if (client) {
    console.log(`[MCP] Stopping server: ${id}`);
    try {
      client.process.kill();
    } catch (e: any) {
      console.error(`[MCP] Error killing process:`, e.message);
    }
    mcpClients.delete(id);
  }
}

let mainWindow: BrowserWindow | null = null;

function getWindowIconPath(): string {
  const icoPath = path.join(__dirname, 'icon.ico');
  const pngPath = path.join(__dirname, 'icon.png');

  if (process.platform === 'win32') {
    return fs.existsSync(icoPath) ? icoPath : pngPath;
  }

  return fs.existsSync(pngPath) ? pngPath : icoPath;
}

function createWindow(): void {
  const windowIconPath = getWindowIconPath();
  const windowIcon = nativeImage.createFromPath(windowIconPath);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: windowIcon.isEmpty() ? windowIconPath : windowIcon,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (process.env.NODE_ENV === 'development') {
    // Retry loading from webpack dev server with backoff
    const loadDevUrl = async () => {
      const maxRetries = 20;
      const devUrl = 'http://localhost:9000';
      for (let i = 0; i < maxRetries; i++) {
        try {
          const resp = await fetch(devUrl, { method: 'HEAD' });
          if (resp.ok) {
            mainWindow!.loadURL(devUrl);
            mainWindow!.webContents.openDevTools();
            return;
          }
        } catch {
          // Dev server not ready yet
        }
        console.log(`[Main] Waiting for webpack dev server... (${i + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 1000));
      }
      console.error('[Main] Webpack dev server not ready after 20s, loading URL anyway...');
      mainWindow!.loadURL(devUrl);
      mainWindow!.webContents.openDevTools();
    };
    loadDevUrl();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 等待页面加载完成后再显示
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle load failures gracefully
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL) => {
    console.error(`[Main] Page load failed: ${errorCode} ${errorDesc} (${validatedURL})`);
    if (process.env.NODE_ENV === 'development') {
      // Retry loading dev server URL after a delay
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log('[Main] Retrying loadURL http://localhost:9000...');
          mainWindow.loadURL('http://localhost:9000');
        }
      }, 2000);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startGoalStateWatchdog();
  createWindow();
  startGoalDispatchWatchdog();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      dispatchDueGoalQueueItems('activate');
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopGoalDispatchWatchdog();
    stopGoalStateWatchdog();
    app.quit();
  }
});

ipcMain.on('window-minimize', (event: IpcMainEvent) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('window-maximize', (event: IpcMainEvent) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});

ipcMain.on('window-close', (event: IpcMainEvent) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('dialog-open-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog-save-file', async (_event: any, options: FileDialogOptions) => {
  const result = await dialog.showSaveDialog({
    defaultPath: options.defaultPath,
    filters: options.filters || [{ name: 'Markdown', extensions: ['md'] }, { name: 'All Files', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('read-directory', async (_event: any, dirPath: string): Promise<FileEntry[]> => {
  try {
    const cacheKey = `dir:${dirPath}`;
    const cached = directoryCache.get(cacheKey) as FileEntry[] | undefined;
    if (cached !== undefined) return cached;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const result: FileEntry[] = entries.map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
    }));
    directoryCache.set(cacheKey, result);
    return result;
  } catch {
    return [];
  }
});

ipcMain.handle('read-file', async (_event: any, filePath: string) => {
  try {
    // 尝试获取文件 mtime 作为缓存 key 的一部分
    let cacheKey = '';
    try {
      const stat = fs.statSync(filePath);
      cacheKey = `file:${filePath}:${stat.mtimeMs}`;
    } catch {
      cacheKey = `file:${filePath}:nomtime`;
    }
    const cached = fileContentCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const content = fs.readFileSync(filePath, 'utf-8');
    fileContentCache.set(cacheKey, content);
    return content;
  } catch {
    return null;
  }
});

ipcMain.handle('write-file', async (_event: any, filePath: string, content: string) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('app-state-read', async (_event: any, key: string) => {
  const cacheKey = `appstate:${key}`;
  const cached = appStateCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const value = readJsonState(key);
  appStateCache.set(cacheKey, value);
  return value;
});

ipcMain.handle('app-state-write', async (_event: any, key: string, value: unknown) => {
  try {
    writeJsonState(key, value);
    return true;
  } catch (err: any) {
    console.error(`[AppState] Failed to write state "${key}":`, err.message);
    return false;
  }
});

ipcMain.handle('app-state-remove', async (_event: any, key: string) => {
  try {
    const filePath = getAppStatePath(key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (err: any) {
    console.error(`[AppState] Failed to remove state "${key}":`, err.message);
    return false;
  }
});

ipcMain.handle('goal-queue-claim', async (_event: any, goalId: string) => {
  try {
    if (!goalId) return null;
    return claimGoalQueueItem(goalId);
  } catch (err: any) {
    console.error(`[GoalState] Failed to claim queue item "${goalId}":`, err.message);
    return null;
  }
});

ipcMain.handle('goal-queue-heartbeat', async (_event: any, goalId: string) => {
  try {
    if (!goalId) return null;
    return heartbeatGoalQueueItem(goalId);
  } catch (err: any) {
    console.error(`[GoalState] Failed to heartbeat queue item "${goalId}":`, err.message);
    return null;
  }
});

ipcMain.handle('goal-queue-complete', async (_event: any, goalId: string, targetGoalId?: string) => {
  try {
    if (!goalId) return null;
    const note = targetGoalId
                  ? `已移交给续跑目标：${targetGoalId}`
      : '续跑源任务已完成';
    return finishGoalQueueItem(goalId, 'completed', note, { targetGoalId });
  } catch (err: any) {
    console.error(`[GoalState] Failed to complete queue item "${goalId}":`, err.message);
    return null;
  }
});

ipcMain.handle('goal-queue-fail', async (_event: any, goalId: string, note?: string) => {
  try {
    if (!goalId) return null;
    return finishGoalQueueItem(goalId, 'failed', note || '续跑任务失败，已保存断点');
  } catch (err: any) {
    console.error(`[GoalState] Failed to fail queue item "${goalId}":`, err.message);
    return null;
  }
});

async function executeGoalRunnerTool(toolName: string, args: string, toolCallId?: string): Promise<string> {
  let parsedArgs: any = {};
  try {
    parsedArgs = JSON.parse(args || '{}');
  } catch (err: any) {
    return `Error: Invalid tool arguments JSON: ${err.message}`;
  }

  try {
    switch (toolName) {
      case 'read': {
        const filePath = parsedArgs.file_path;
        if (!filePath) return 'Error: Missing file_path argument';
        if (!path.isAbsolute(filePath)) return 'Error: file_path MUST be an absolute path (e.g. D:\\... or /Users/...). You provided a relative path.';
        return fs.readFileSync(filePath, 'utf-8');
      }
      case 'write': {
        const filePath = parsedArgs.file_path;
        const content = parsedArgs.content;
        if (!filePath) return 'Error: Missing file_path argument';
        if (!path.isAbsolute(filePath)) return 'Error: file_path MUST be an absolute path (e.g. D:\\... or /Users/...). You provided a relative path.';
        if (content === undefined) return 'Error: Missing content argument';
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        return `File written successfully: ${filePath}`;
      }
      case 'edit': {
        const filePath = parsedArgs.file_path;
        const oldStr = parsedArgs.old_str;
        const newStr = parsedArgs.new_str || '';
        if (!filePath) return 'Error: Missing file_path argument';
        if (!path.isAbsolute(filePath)) return 'Error: file_path MUST be an absolute path (e.g. D:\\... or /Users/...). You provided a relative path.';
        if (!oldStr) return 'Error: Missing old_str argument';
        const content = fs.readFileSync(filePath, 'utf-8');
        const matchCount = content.split(oldStr).length - 1;
        if (matchCount === 0) return 'Error: old_str not found in file';
        if (matchCount > 1) return `Error: old_str found ${matchCount} times in file; provide a more unique string.`;
        fs.writeFileSync(filePath, content.replace(oldStr, newStr), 'utf-8');
        return `File edited successfully: ${filePath}`;
      }
      case 'bash': {
        const command = parsedArgs.command;
        const cwd = typeof parsedArgs.cwd === 'string' && parsedArgs.cwd.trim() ? parsedArgs.cwd.trim() : undefined;
        if (!command) return 'Error: Missing command argument';
        const isWindows = process.platform === 'win32';
        const shellToUse = isWindows ? 'powershell.exe' : '/bin/bash';
        const finalCommand = isWindows
          ? [
              'chcp 65001 >$null;',
              '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);',
              '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false);',
              "$env:PYTHONIOENCODING='utf-8';",
              normalizeWindowsShellCommand(command),
            ].join(' ')
          : command;
        const shellArgs = isWindows
          ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', finalCommand]
          : ['-c', finalCommand];
        const child = spawn(shellToUse, shellArgs, {
          timeout: 120000,
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8' },
          cwd,
        });
        const activeProcessId = toolCallId || `goal_bash_${Date.now()}_${child.pid || Math.random().toString(36).slice(2, 8)}`;
        activeToolProcesses.set(activeProcessId, child);
        child.once('close', () => activeToolProcesses.delete(activeProcessId));
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let spawnErrorMessage = '';
        child.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        child.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        const exitResult = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
          child.on('close', (code, signal) => resolve({ code, signal }));
          child.on('error', (err) => {
            spawnErrorMessage = err.message || String(err);
            resolve({ code: -1, signal: null });
          });
        });
        const output = decodeToolOutputBuffer(Buffer.concat(stdoutChunks)) || decodeToolOutputBuffer(Buffer.concat(stderrChunks)) || '(no output)';
        if (cancelledToolProcessIds.has(activeProcessId)) {
          cancelledToolProcessIds.delete(activeProcessId);
          return 'Error: Command cancelled by user';
        }
        cancelledToolProcessIds.delete(activeProcessId);
        if (exitResult.signal === 'SIGTERM' || exitResult.signal === 'SIGKILL' || child.killed) return 'Error: Command timed out after 120s';
        if (exitResult.code === -1 && spawnErrorMessage) return `Error: ${enrichWindowsErrorMsg(spawnErrorMessage, command)}`;
        if (exitResult.code !== 0) return `Error: Command exited with code ${exitResult.code}\n${enrichWindowsErrorMsg(output, command)}`;
        return output;
      }
      default:
        return `Error: Unknown goal tool: ${toolName}`;
    }
  } catch (err: any) {
    return `Error: ${err.message || 'Tool execution failed'}`;
  }
}

async function runGoalInMainProcess(payload: GoalRunExecutePayload): Promise<GoalRunExecuteResult | null> {
  const run = startGoalRunState(payload);
  let latestGoalSnapshot: any = payload.existingGoal || payload.goalSnapshot || null;
  let latestAgents: any[] = payload.agentsSnapshot || [];
  const heartbeat = setInterval(() => {
    void heartbeatGoalRunState(run.id, {
      goalId: latestGoalSnapshot?.id || run.goalId,
      description: latestGoalSnapshot?.description || payload.description,
      statusNote: '目标在主进程运行中',
      goalSnapshot: latestGoalSnapshot,
      agentsSnapshot: latestAgents,
    });
  }, Math.max(10_000, Math.floor(GOAL_RUNNING_LEASE_MS / 3)));
  heartbeat.unref?.();

  try {
    const callLLM = async (prompt: string): Promise<string> => {
      const control = readGoalRunControlState(run.id);
      if (control) {
        acknowledgeGoalRunControlState(run.id);
        throw new Error(control.reason || `Goal run received ${control.action} request`);
      }
      let messages: Array<{ role: string; content: string }>;
      try {
        const parsed = JSON.parse(prompt);
        messages = Array.isArray(parsed) ? parsed : [{ role: 'user', content: prompt }];
      } catch {
        messages = [{ role: 'user', content: prompt }];
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);
      try {
        const response = await fetch(buildChatCompletionsUrl(payload.apiSettings.baseURL), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${payload.apiSettings.apiKey}`,
            'X-Session-Id': payload.conversationId || run.id,
          },
          body: JSON.stringify({
            model: payload.apiSettings.model,
            messages,
            temperature: payload.apiSettings.temperature ?? 0.3,
            max_tokens: payload.apiSettings.maxTokens,
            prompt_cache_key: (payload.conversationId || run.id).slice(0, 64),
          }),
          signal: controller.signal,
        });
        const body = await response.text();
        if (!response.ok) throw new Error(`API error: ${response.status} - ${body}`);
        return JSON.parse(body).choices?.[0]?.message?.content || '';
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const goalExecutor = new GoalExecutor(
      callLLM,
      (toolName, args) => executeGoalRunnerTool(toolName, args, `main_goal_tool_${Date.now()}`),
      payload.maxConcurrentAgents || 1
    );
    goalExecutor.onEvent((event) => {
      if ('goalId' in event) {
        const updatedGoal = goalExecutor.getGoal(event.goalId);
        if (updatedGoal) {
          latestGoalSnapshot = { ...updatedGoal, subTasks: updatedGoal.subTasks.map((task) => ({ ...task })) };
          latestAgents = goalExecutor.getAgentStatus().map((agent) => ({ ...agent }));
        }
      }
      void appendGoalRunEventState(run.id, {
        type: event.type,
        message: event.type,
        goalId: 'goalId' in event ? event.goalId : latestGoalSnapshot?.id,
        description: latestGoalSnapshot?.description || payload.description,
        statusNote: event.type,
        goalSnapshot: latestGoalSnapshot,
        agentsSnapshot: latestAgents,
      });
    });

    const goal = payload.existingGoal
      ? await goalExecutor.resumeGoal(payload.existingGoal)
      : await goalExecutor.executeGoal(payload.description || 'Goal', {
          projectInfo: payload.workspacePath ? `Project path: ${payload.workspacePath}` : undefined,
        });
    latestGoalSnapshot = goal;
    latestAgents = goalExecutor.getAgentStatus().map((agent) => ({ ...agent }));
    clearInterval(heartbeat);
    if (goal.status === 'failed') {
      finishGoalRunState(run.id, 'failed', goal.error || '目标执行失败');
    } else {
      finishGoalRunState(run.id, 'completed');
    }
    return { run: readGoalRunsState().find((item) => item.id === run.id) || run, goal, agents: latestAgents };
  } catch (err: any) {
    clearInterval(heartbeat);
    const failedGoal = latestGoalSnapshot
      ? { ...latestGoalSnapshot, status: 'failed', error: err.message || String(err), updatedAt: Date.now() }
      : { id: payload.goalId || `failed_${run.id}`, description: payload.description || 'Goal', status: 'failed', createdAt: run.startedAt, updatedAt: Date.now(), subTasks: [], error: err.message || String(err) };
    finishGoalRunState(run.id, 'failed', err.message || String(err));
    return { run: readGoalRunsState().find((item) => item.id === run.id) || run, goal: failedGoal, agents: latestAgents };
  }
}

ipcMain.handle('goal-run-start', async (_event: any, payload: GoalRunStartPayload) => {
  try {
    return startGoalRunState(payload);
  } catch (err: any) {
    console.error('[GoalRun] Failed to start run:', err.message);
    return null;
  }
});

ipcMain.handle('goal-run-execute', async (_event: any, payload: GoalRunExecutePayload) => {
  try {
    if (!payload?.apiSettings?.baseURL || !payload?.apiSettings?.apiKey || !payload?.apiSettings?.model) {
      throw new Error('Missing API settings for main-process goal execution');
    }
    return await runGoalInMainProcess(payload);
  } catch (err: any) {
    console.error('[GoalRun] Failed to execute run in main process:', err.message);
    return null;
  }
});

ipcMain.handle('goal-run-latest-running', async () => {
  try {
    return readLatestRunningGoalRunState();
  } catch (err: any) {
    console.error('[GoalRun] Failed to read latest running run:', err.message);
    return null;
  }
});

ipcMain.handle('goal-run-heartbeat', async (_event: any, runId: string, patch?: GoalRunHeartbeatPatch) => {
  try {
    if (!runId) return null;
    return heartbeatGoalRunState(runId, patch || {});
  } catch (err: any) {
    console.error(`[GoalRun] Failed to heartbeat run "${runId}":`, err.message);
    return null;
  }
});

ipcMain.handle('goal-run-event', async (_event: any, runId: string, event: GoalRunEventPatch) => {
  try {
    if (!runId || !event?.type) return null;
    return appendGoalRunEventState(runId, event);
  } catch (err: any) {
    console.error(`[GoalRun] Failed to append event for run "${runId}":`, err.message);
    return null;
  }
});

ipcMain.handle('goal-run-complete', async (_event: any, runId: string) => {
  try {
    if (!runId) return null;
    return finishGoalRunState(runId, 'completed');
  } catch (err: any) {
    console.error(`[GoalRun] Failed to complete run "${runId}":`, err.message);
    return null;
  }
});

ipcMain.handle('goal-run-fail', async (_event: any, runId: string, error?: string) => {
  try {
    if (!runId) return null;
    return finishGoalRunState(runId, 'failed', error);
  } catch (err: any) {
    console.error(`[GoalRun] Failed to fail run "${runId}":`, err.message);
    return null;
  }
});

ipcMain.handle('goal-run-control-request', async (_event: any, runId: string, action: GoalRunControlAction, reason?: string) => {
  try {
    if (!runId || !['pause', 'cancel', 'stop'].includes(action)) return null;
    return requestGoalRunControlState(runId, action, reason);
  } catch (err: any) {
    console.error(`[GoalRun] Failed to request control for run "${runId}":`, err.message);
    return null;
  }
});

ipcMain.handle('goal-run-control-read', async (_event: any, runId: string) => {
  try {
    if (!runId) return null;
    return readGoalRunControlState(runId);
  } catch (err: any) {
    console.error(`[GoalRun] Failed to read control for run "${runId}":`, err.message);
    return null;
  }
});

ipcMain.handle('goal-run-control-ack', async (_event: any, runId: string) => {
  try {
    if (!runId) return null;
    return acknowledgeGoalRunControlState(runId);
  } catch (err: any) {
    console.error(`[GoalRun] Failed to acknowledge control for run "${runId}":`, err.message);
    return null;
  }
});

ipcMain.handle('tools-cancel-active', async () => {
  let cancelled = 0;
  for (const [id, child] of activeToolProcesses.entries()) {
    if (!child.killed) {
      try {
        cancelledToolProcessIds.add(id);
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill('SIGTERM');
        }
        cancelled++;
      } catch (err: any) {
        console.warn(`[Tool] Failed to cancel active process "${id}":`, err.message);
      }
    }
  }
  return cancelled;
});

function enrichWindowsErrorMsg(originalOutput: string, command: string): string {
  if (process.platform !== 'win32') return originalOutput;
  
  const lowerOut = originalOutput.toLowerCase();
  const lowerCmd = command.toLowerCase();
  const suggestions: string[] = [];
  
  if (
    lowerOut.includes('not recognized as an internal or external command') || 
    lowerOut.includes('commandnotfoundexception') || 
        lowerOut.includes('无法识别') ||
    lowerOut.includes('is not recognized')
  ) {
    if (lowerCmd.includes('head')) {
      suggestions.push("Use a simple Python script or native command like 'Select-Object -First N' to read the first few lines of a file, instead of 'head'.");
    }
    if (lowerCmd.includes('grep')) {
      suggestions.push("Use the Windows native 'findstr' command instead of 'grep', or write a simple Python script using 're' module.");
    }
    if (lowerCmd.includes('ls')) {
      suggestions.push("Use PowerShell's 'Get-ChildItem' command instead of 'ls' when compatibility matters.");
    }
    if (lowerCmd.includes('cat')) {
      suggestions.push("Use PowerShell's 'Get-Content -Encoding UTF8' command instead of 'cat', or use the 'read' tool directly.");
    }
    if (lowerCmd.includes('pwd')) {
      suggestions.push("Use PowerShell's 'Get-Location' command instead of 'pwd'.");
    }
    if (lowerCmd.includes('which')) {
      suggestions.push("Use PowerShell's 'Get-Command' command instead of 'which'.");
    }
  }
  
  if (suggestions.length > 0) {
    return originalOutput + `\n\n[System Tip: You are executing commands on Windows using PowerShell with UTF-8 output. Some Unix-specific utilities are not available. Please try the following suggestions:\n${suggestions.map(s => `- ${s}`).join('\n')}]`;
  }
  
  return originalOutput;
}

function normalizeWindowsShellCommand(command: string): string {
  let normalized = command.trim();

  normalized = normalized
    .replace(/\bcd\s+\/d\s+("[^"]+"|'[^']+'|[^\r\n;&|]+)/gi, 'Set-Location -LiteralPath $1')
    .replace(/(^|[;&]\s*)cd\s+("[^"]+"|'[^']+'|[A-Za-z]:[^\r\n;&|]+)/gi, '$1Set-Location -LiteralPath $2')
    .replace(/\bdir\s+\/s\s+\/b\s+("[^"]+"|'[^']+'|[^\r\n;&|]+)/gi, 'Get-ChildItem -Recurse -Name -LiteralPath $1')
    .replace(/\bdir\s+\/s\s+\/b(?=\s*(?:[;&|]|$))/gi, 'Get-ChildItem -Recurse -Name')
    .replace(/\bdir\s+\/b\s+("[^"]+"|'[^']+'|[^\r\n;&|]+)/gi, 'Get-ChildItem -Name -LiteralPath $1')
    .replace(/\bdir\s+\/b(?=\s*(?:[;&|]|$))/gi, 'Get-ChildItem -Name')
    .replace(/\bls\s+-la\s+("[^"]+"|'[^']+'|[^\r\n;&|]+)/gi, 'Get-ChildItem -Force -LiteralPath $1')
    .replace(/\bls\s+-la(?=\s*(?:[;&|]|$))/gi, 'Get-ChildItem -Force')
    .replace(/\bls\s+-a\s+("[^"]+"|'[^']+'|[^\r\n;&|]+)/gi, 'Get-ChildItem -Force -LiteralPath $1')
    .replace(/\bls\s+-a(?=\s*(?:[;&|]|$))/gi, 'Get-ChildItem -Force')
    .replace(/\bls\s+("[^"]+"|'[^']+'|[A-Za-z]:[^\r\n;&|]+)/gi, 'Get-ChildItem -LiteralPath $1')
    .replace(/\brmdir\s+\/s\s+\/q\s+("[^"]+"|'[^']+'|[^\r\n;&|]+)/gi, 'Remove-Item -LiteralPath $1 -Recurse -Force')
    .replace(/\bcat\s+("[^"]+"|'[^']+'|[A-Za-z]:[^\r\n;&|]+)/gi, 'Get-Content -Encoding UTF8 -LiteralPath $1')
    .replace(/\btype\s+("[^"]+"|'[^']+'|[A-Za-z]:[^\r\n;&|]+)/gi, 'Get-Content -Encoding UTF8 -LiteralPath $1')
    .replace(/\bpwd\b/gi, 'Get-Location')
    .replace(/\becho\s+%cd%/gi, 'Get-Location')
    .replace(/\bwhere\s+([^\s;&|]+)/gi, 'Get-Command $1')
    .replace(/\bwhich\s+([^\s;&|]+)/gi, 'Get-Command $1')
    .replace(/2>\s*nul/gi, '2>$null')
    .replace(/\s\|\|\s*echo\s+(.+)$/gi, '; if (-not $?) { Write-Output $1 }')
    .replace(/\s&&\s/g, '; if ($?) { ');

  return normalized;
}

function decodeToolOutputChunk(chunk: Buffer): string {
  const utf8Text = chunk.toString('utf8');
  if (!utf8Text.includes('\uFFFD')) return utf8Text;

  try {
    return new TextDecoder('gb18030').decode(chunk);
  } catch {
    return utf8Text;
  }
}

function decodeToolOutputBuffer(buffer: Buffer): string {
  if (buffer.length === 0) return '';

  const utf8Text = buffer.toString('utf8');
  const replacementCount = (utf8Text.match(/\uFFFD/g) || []).length;
  if (replacementCount === 0) return utf8Text;

  try {
    const gbText = new TextDecoder('gb18030').decode(buffer);
    const gbReplacementCount = (gbText.match(/\uFFFD/g) || []).length;
    return gbReplacementCount < replacementCount ? gbText : utf8Text;
  } catch {
    return utf8Text;
  }
}

// Tool execution handlers
ipcMain.handle('execute-tool', async (_event: any, toolName: string, args: string, toolCallId?: string): Promise<ToolExecutionResult> => {
  try {
    let parsedArgs: any;
    try {
      parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
    } catch (parseErr: any) {
      console.error(`[Tool] Failed to parse arguments for ${toolName}:`, args);
      return { success: false, error: `Invalid tool arguments: ${parseErr.message}` };
    }
    console.log(`[Tool] Executing ${toolName} with args:`, parsedArgs);
    
    switch (toolName) {
      case 'read': {
        const filePath = parsedArgs.file_path;
        if (!filePath) return { success: false, error: 'Missing file_path argument' };
        try {
          if (toolCallId && mainWindow) {
            mainWindow.webContents.send('tool-live-output', { toolCallId, text: `正在读取文件: ${filePath}...\n` });
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          console.log(`[Tool] Read ${filePath}: ${content.length} chars`);
          if (toolCallId && mainWindow) {
            mainWindow.webContents.send('tool-live-output', { toolCallId, text: `✓ 文件读取完成: ${filePath} (${content.length} 字符)\n` });
          }
          return { success: true, result: content };
        } catch (err: any) {
          console.error(`[Tool] Read error:`, err.message);
          return { success: false, error: err.message };
        }
      }
      
      case 'write': {
        const filePath = parsedArgs.file_path;
        const content = parsedArgs.content;
        if (!filePath) return { success: false, error: 'Missing file_path argument' };
        if (content === undefined) return { success: false, error: 'Missing content argument' };
        try {
          const dir = path.dirname(filePath);
          if (dir && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          const CHUNK_SIZE = 65536;
          if (content.length > CHUNK_SIZE && toolCallId && mainWindow) {
            const stream = fs.createWriteStream(filePath, { encoding: 'utf-8' });
            let offset = 0;
            await new Promise<void>((resolve, reject) => {
              stream.on('error', reject);
              function writeNext() {
                let ok = true;
                while (ok && offset < content.length) {
                  const chunk = content.substring(offset, Math.min(offset + CHUNK_SIZE, content.length));
                  offset += chunk.length;
                  ok = stream.write(chunk);
                  const progress = Math.min(100, Math.floor((offset / content.length) * 100));
                  mainWindow!.webContents.send('tool-live-output', { toolCallId, text: `正在写入: ${filePath} — ${progress}% (${offset}/${content.length} 字符)\n` });
                }
                if (offset >= content.length) {
                  stream.end(resolve);
                } else {
                  stream.once('drain', writeNext);
                }
              }
              writeNext();
            });
          } else {
            if (toolCallId && mainWindow) {
              mainWindow.webContents.send('tool-live-output', { toolCallId, text: `正在写入文件: ${filePath} (${content.length} 字符)...\n` });
            }
            fs.writeFileSync(filePath, content, 'utf-8');
          }
          console.log(`[Tool] Wrote ${filePath}: ${content.length} chars`);
          if (toolCallId && mainWindow) {
            mainWindow.webContents.send('tool-live-output', { toolCallId, text: `✓ 文件写入完成: ${filePath} (${content.length} 字符)\n` });
          }
          return { success: true, result: `File written successfully: ${filePath}` };
        } catch (err: any) {
          console.error(`[Tool] Write error:`, err.message);
          return { success: false, error: err.message };
        }
      }
      
      case 'edit': {
        const filePath = parsedArgs.file_path;
        const oldStr = parsedArgs.old_str;
        const newStr = parsedArgs.new_str || '';
        if (!filePath) return { success: false, error: 'Missing file_path argument' };
        if (!oldStr) return { success: false, error: 'Missing old_str argument' };
        try {
          if (toolCallId && mainWindow) {
            mainWindow.webContents.send('tool-live-output', { toolCallId, text: `正在编辑文件: ${filePath}...\n` });
          }
          let content = fs.readFileSync(filePath, 'utf-8');

          // 1. Exact match (detect multiple occurrences to avoid silent wrong replacement)
          if (content.includes(oldStr)) {
            const matchCount = content.split(oldStr).length - 1;
            if (matchCount > 1) {
              return { success: false, error: `old_str found ${matchCount} times in file. Please provide a more unique string to target the correct location.` };
            }
            content = content.replace(oldStr, newStr);
            fs.writeFileSync(filePath, content, 'utf-8');
            console.log(`[Tool] Edited ${filePath} (exact)`);
            if (toolCallId && mainWindow) {
              mainWindow.webContents.send('tool-live-output', { toolCallId, text: `✓ 文件编辑完成: ${filePath}\n` });
            }
            return { success: true, result: `File edited successfully: ${filePath}` };
          }

          // 2. Fuzzy match: normalize whitespace
          const fuzzyResult = fuzzyEdit(content, oldStr, newStr);
          if (fuzzyResult.success && fuzzyResult.content) {
            fs.writeFileSync(filePath, fuzzyResult.content, 'utf-8');
            console.log(`[Tool] Edited ${filePath} (fuzzy: ${fuzzyResult.method}, similarity: ${fuzzyResult.similarity?.toFixed(2)})`);
            if (toolCallId && mainWindow) {
              mainWindow.webContents.send('tool-live-output', { toolCallId, text: `✓ 文件编辑完成: ${filePath} (${fuzzyResult.method})\n` });
            }
            return { success: true, result: `File edited successfully: ${filePath} (matched via ${fuzzyResult.method})` };
          }

          return { success: false, error: 'old_str not found in file' };
        } catch (err: any) {
          console.error(`[Tool] Edit error:`, err.message);
          return { success: false, error: err.message };
        }
      }
      
      case 'bash': {
        const command = parsedArgs.command;
        const cwd = typeof parsedArgs.cwd === 'string' && parsedArgs.cwd.trim() ? parsedArgs.cwd.trim() : undefined;
        if (!command) return { success: false, error: 'Missing command argument' };
        
        // Safety Interception: Prevent AI from killing node.exe / electron.exe host
        const lowerCmd = command.toLowerCase();
        if (
          (lowerCmd.includes('taskkill') || lowerCmd.includes('stop-process') || lowerCmd.includes('pkill') || lowerCmd.includes('killall')) &&
          (lowerCmd.includes('node') || lowerCmd.includes('electron'))
        ) {
          console.warn(`[Tool][Bash] Safety Interception: Blocked command trying to kill Node/Electron host: "${command}"`);
          return {
            success: false,
            error: '安全拦截：检测到终止 Node.exe 或 Electron 主进程的命令。为防止 IDE 主程序意外退出，禁止以进程名形式（IM）批量杀死 node/electron。如需释放端口占用，请使用 netstat -ano 查找具体端口的 PID，并使用 taskkill /F /PID <PID> 仅终止目标子进程。'
          };
        }
        try {
          const env = {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --enable-source-maps`.trim(),
            LANG: 'zh_CN.UTF-8',
            LC_ALL: 'zh_CN.UTF-8',
            LESSCHARSET: 'utf-8',
            GIT_CONFIG_COUNT: '2',
            GIT_CONFIG_KEY_0: 'core.quotepath',
            GIT_CONFIG_VALUE_0: 'false',
            GIT_CONFIG_KEY_1: 'i18n.logOutputEncoding',
            GIT_CONFIG_VALUE_1: 'utf-8',
          };

          const isWindows = process.platform === 'win32';
          const shellToUse = isWindows ? 'powershell.exe' : '/bin/bash';
          const finalCommand = isWindows
            ? [
                'chcp 65001 >$null;',
                '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);',
                '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false);',
                "$env:PYTHONIOENCODING='utf-8';",
                "$env:LANG='zh_CN.UTF-8';",
                normalizeWindowsShellCommand(command),
              ].join(' ')
            : command;

          const shellArgs = isWindows
            ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', finalCommand]
            : ['-c', finalCommand];
          const child = spawn(shellToUse, shellArgs, { 
            timeout: 120000,
            windowsHide: true,
            env,
            cwd,
          });
          const activeProcessId = toolCallId || `bash_${Date.now()}_${child.pid || Math.random().toString(36).slice(2, 8)}`;
          activeToolProcesses.set(activeProcessId, child);
          child.once('close', () => {
            activeToolProcesses.delete(activeProcessId);
          });

          let stdoutAccumulator = '';
          let stderrAccumulator = '';
          const stdoutChunks: Buffer[] = [];
          const stderrChunks: Buffer[] = [];
          const stdoutLiveDecoder = new TextDecoder('utf-8', { fatal: false });
          const stderrLiveDecoder = new TextDecoder('utf-8', { fatal: false });
          let spawnErrorMessage = '';

          child.stdout?.on('data', (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            stdoutChunks.push(buffer);
            const text = stdoutLiveDecoder.decode(buffer, { stream: true });
            stdoutAccumulator += text;
            if (toolCallId && mainWindow) {
              mainWindow.webContents.send('tool-live-output', { toolCallId, text });
            }
          });

          child.stderr?.on('data', (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            stderrChunks.push(buffer);
            const text = stderrLiveDecoder.decode(buffer, { stream: true });
            stderrAccumulator += text;
            if (toolCallId && mainWindow) {
              mainWindow.webContents.send('tool-live-output', { toolCallId, text });
            }
          });

          const exitResult = await new Promise<{ code: number | null, signal: string | null }>((resolve) => {
            child.on('close', (code, signal) => {
              resolve({ code, signal });
            });
            child.on('error', (err) => {
              console.error('[Tool] Spawn error:', err);
              spawnErrorMessage = err.message || String(err);
              resolve({ code: -1, signal: null });
            });
          });

          console.log(`[Tool] Bash executed: ${command} with code ${exitResult.code} signal ${exitResult.signal}`);
          const stdoutTail = stdoutLiveDecoder.decode();
          const stderrTail = stderrLiveDecoder.decode();
          if (stdoutTail) stdoutAccumulator += stdoutTail;
          if (stderrTail) stderrAccumulator += stderrTail;
          const finalStdout = decodeToolOutputBuffer(Buffer.concat(stdoutChunks)) || stdoutAccumulator;
          const finalStderr = decodeToolOutputBuffer(Buffer.concat(stderrChunks)) || stderrAccumulator;
          
          if (cancelledToolProcessIds.has(activeProcessId)) {
            cancelledToolProcessIds.delete(activeProcessId);
            return { success: false, error: 'Command cancelled by user' };
          }
          cancelledToolProcessIds.delete(activeProcessId);

          if (exitResult.signal === 'SIGTERM' || exitResult.signal === 'SIGKILL' || child.killed) {
            return { success: false, error: 'Command timed out after 120s' };
          }

          if (exitResult.code === -1 && spawnErrorMessage) {
            const enriched = enrichWindowsErrorMsg(spawnErrorMessage, command);
            return { success: false, error: enriched };
          }

          const combinedOutput = finalStdout || finalStderr || '(no output)';
          
          if (exitResult.code !== 0) {
            const enriched = enrichWindowsErrorMsg(combinedOutput, command);
            return { success: false, error: `Command exited with code ${exitResult.code}\n${enriched}` };
          }

          // For GUI-launching commands (Start-Process, Invoke-Item, start, xdg-open, open)
          // that produce no stdout or minimal output, provide a clear success message
          // so the LLM doesn't misinterpret the result as failure and retry.
          const guiLaunchPatterns = /Start-Process|Invoke-Item|\bstart\s|xdg-open|\bopen\s|cmd\s*\/c\s*start/i;
          const isGuiLaunch = guiLaunchPatterns.test(command);
          if (isGuiLaunch && exitResult.code === 0) {
            const guiMessage = combinedOutput === '(no output)'
              ? 'Command executed successfully. The GUI process (browser or application) has been launched and should be visible on the user\'s desktop. No console output is expected for GUI commands.'
              : `Command executed successfully. Output: ${combinedOutput}. The GUI process is running and visible on the user's desktop.`;
            return { success: true, result: `${guiMessage} IMPORTANT: This command SUCCEEDED. The file/application IS open. Do NOT say it might not have opened. Do NOT suggest the user open it manually. Do NOT retry this command.` };
          }

          return { success: true, result: combinedOutput };
        } catch (err: any) {
          console.error(`[Tool] Spawn catch error:`, err.message);
          const enrichedMsg = enrichWindowsErrorMsg(err.message || 'Command execution failed', command);
          return { success: false, error: enrichedMsg };
        }
      }

      case 'web': {
        const url = parsedArgs.url;
        if (!url) return { success: false, error: 'Missing url argument' };
        try {
          const { scrapeUrl } = require('./web-scraper');
          const result = await scrapeUrl(url, {
            maxLength: parsedArgs.max_length || 15000,
            extractLinks: parsedArgs.extract_links !== false,
          });
          if (result.success) {
            let output = '';
            if (result.title) output += `Title: ${result.title}\n`;
            output += `URL: ${result.url}\n\n`;
            output += result.content || '(empty page)';
            if (result.links && result.links.length > 0) {
              output += '\n\n--- Links ---\n';
              output += result.links.map((l: any) => `- [${l.text}](${l.href})`).join('\n');
            }
            return { success: true, result: output };
          } else {
            return { success: false, error: result.error || 'Failed to fetch URL' };
          }
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      case 'config': {
        const action = parsedArgs.action || 'read';
        const key = parsedArgs.key;
        const value = parsedArgs.value;
        try {
          const { executeConfigOperation } = require('./config-tool');
          const result = executeConfigOperation({ action, key, value });
          if (result.success) {
            // Notify renderer to reload settings if we made a change
            if (action === 'set' && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('settings-changed', { key, value });
            }
            return { success: true, result: result.message || JSON.stringify(result.value, null, 2) };
          } else {
            return { success: false, error: result.error || 'Config operation failed' };
          }
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      case 'createTool': {
        const { saveCustomTool } = require('./tool-creator');
        const toolDef = {
          name: parsedArgs.name,
          description: parsedArgs.description || '',
          parameters: parsedArgs.parameters || {},
          script: parsedArgs.script || '',
          language: parsedArgs.language || 'javascript',
        };
        if (!toolDef.name || !toolDef.script) {
          return { success: false, error: 'Missing name or script for createTool' };
        }
        const result = saveCustomTool(toolDef);
        if (result.success) {
          // Notify renderer to reload custom tools
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('custom-tools-changed');
          }
          return { success: true, result: `Tool "${toolDef.name}" created successfully. It can now be called with the executeTool tool.` };
        } else {
          return { success: false, error: result.error };
        }
      }

      case 'deleteTool': {
        const { deleteCustomTool } = require('./tool-creator');
        const name = parsedArgs.name;
        if (!name) return { success: false, error: 'Missing tool name' };
        const result = deleteCustomTool(name);
        if (result.success) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('custom-tools-changed');
          }
          return { success: true, result: `Tool "${name}" deleted` };
        } else {
          return { success: false, error: result.error };
        }
      }

      case 'listTools': {
        const { loadCustomTools } = require('./tool-creator');
        const tools = loadCustomTools();
        const summary = tools.map((t: any) => `- ${t.name}: ${t.description} (${t.language})`).join('\n');
        return { success: true, result: tools.length > 0 ? `Custom tools:\n${summary}` : 'No custom tools created yet.' };
      }

      case 'executeCustomTool': {
        const { executeCustomTool } = require('./tool-creator');
        const name = parsedArgs.name;
        const toolArgs = parsedArgs.arguments || {};
        if (!name) return { success: false, error: 'Missing tool name' };
        const result = await executeCustomTool(name, toolArgs);
        return result;
      }

      default:
        // Check if it's a custom tool
        try {
          const { loadCustomTools, executeCustomTool } = require('./tool-creator');
          const customTools = loadCustomTools();
          const customTool = customTools.find((t: any) => t.name === toolName);
          if (customTool) {
            const result = await executeCustomTool(toolName, parsedArgs);
            return result;
          }
        } catch {}
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[Tool] General error:`, err.message);
    return { success: false, error: err.message || 'Tool execution failed' };
  }
});

// API proxy to avoid CORS issues in renderer
ipcMain.handle('api-proxy', async (_event, requestData: ApiProxyRequest): Promise<{ status: number; body: string }> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(requestData.url, {
        method: requestData.method,
        headers: {
          ...requestData.headers,
        },
        body: requestData.body,
        signal: controller.signal,
      });
      const body = await response.text();
      return { status: response.status, body };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: any) {
    console.error(`[API] Fetch error for ${requestData.url}:`, err.message);
    return { status: 0, body: `fetch failed: ${err.message}` };
  }
});

// Streaming API proxy. The main process owns fetch so renderer code keeps CORS-free,
// while chunks are pushed back over IPC as soon as they arrive.
ipcMain.handle('api-proxy-stream', async (event, requestData: ApiProxyStreamRequest): Promise<{ status: number; body: string }> => {
  const { streamId, ...fetchData } = requestData;
  const sendStreamEvent = (payload: Record<string, any>) => {
    event.sender.send('api-proxy-stream-event', { streamId, ...payload });
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);
    try {
      const response = await fetch(fetchData.url, {
        method: fetchData.method,
        headers: {
          ...fetchData.headers,
        },
        body: fetchData.body,
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.text();
        sendStreamEvent({ type: 'error', status: response.status, body });
        return { status: response.status, body };
      }

      sendStreamEvent({ type: 'start', status: response.status });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sendStreamEvent({ type: 'chunk', text: decoder.decode(value, { stream: true }) });
      }

      const tail = decoder.decode();
      if (tail) {
        sendStreamEvent({ type: 'chunk', text: tail });
      }

      sendStreamEvent({ type: 'end', status: response.status });
      return { status: response.status, body: '' };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: any) {
    console.error(`[API] Streaming fetch error for ${fetchData.url}:`, err.message);
    const body = `fetch failed: ${err.message}`;
    sendStreamEvent({ type: 'error', status: 0, body });
    return { status: 0, body };
  }
});

// MCP Tool List Loader IPC Handler
ipcMain.handle('load-mcp-tools', async (_event, servers: McpServerConfig[]) => {
  const activeIds = new Set((servers || []).filter(s => s.enabled).map(s => s.id));
  for (const id of Array.from(mcpClients.keys())) {
    if (!activeIds.has(id)) {
      stopMcpServer(id);
    }
  }

  for (const server of (servers || [])) {
    if (server.enabled) {
      await startMcpServer(server);
    }
  }

  const allTools: McpTool[] = [];
  for (const [serverId, client] of mcpClients.entries()) {
    const serverConf = (servers || []).find(s => s.id === serverId);
    const serverName = serverConf?.name || 'mcp-server';
    for (const tool of client.tools) {
      allTools.push({
        ...tool,
        mcpServerId: serverId,
        mcpServerName: serverName,
      });
    }
  }

  return allTools;
});

// MCP Tool Executor IPC Handler
ipcMain.handle('execute-mcp-tool', async (_event, serverId: string, toolName: string, args: string): Promise<ToolExecutionResult> => {
  const client = mcpClients.get(serverId);
  if (!client) {
    return { success: false, error: `MCP server is not connected or active` };
  }

  console.log(`[MCP] Requesting execution of tool ${toolName} on server ${serverId} with args:`, args);
  try {
    let parsedArgs = args;
    if (typeof args === 'string') {
      try {
        parsedArgs = JSON.parse(args);
      } catch {
        parsedArgs = args;
      }
    }

    const MCP_REQUEST_TIMEOUT_MS = 30_000;

    const sendRequest = (method: string, params: any = {}): Promise<any> => {
      return new Promise((resolve, reject) => {
        const id = `call_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        const timer = setTimeout(() => {
          client.pendingRequests.delete(id);
          reject(new Error(`MCP request "${method}" timed out after ${MCP_REQUEST_TIMEOUT_MS}ms`));
        }, MCP_REQUEST_TIMEOUT_MS);

        client.pendingRequests.set(id, {
          resolve: (val: any) => { clearTimeout(timer); resolve(val); },
          reject: (err: any) => { clearTimeout(timer); reject(err); },
        });
        
        const req = {
          jsonrpc: '2.0',
          id,
          method,
          params,
        };
        client.process.stdin?.write(JSON.stringify(req) + '\n');
      });
    };

    const result = await sendRequest('tools/call', {
      name: toolName,
      arguments: parsedArgs
    });

    let resultText = '';
    if (result.content && Array.isArray(result.content)) {
      resultText = result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    } else {
      resultText = JSON.stringify(result);
    }

    return { success: true, result: resultText };

  } catch (err: any) {
    console.error(`[MCP] Tool execution error:`, err.message);
    return { success: false, error: err.message || 'Tool execution failed' };
  }
});

app.on('will-quit', () => {
  stopGoalDispatchWatchdog();
  stopGoalStateWatchdog();
  for (const id of Array.from(mcpClients.keys())) {
    stopMcpServer(id);
  }
});
