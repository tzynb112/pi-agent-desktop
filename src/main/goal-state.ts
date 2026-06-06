import type {
  GoalQueueEvent,
  GoalQueueItem,
  GoalRunControl,
  GoalRunMeta,
  GoalRunState,
} from '../shared/ipc-types';

export interface GoalRunMetaState {
  savedAt?: number;
  lastHeartbeatAt?: number;
  failureCount?: number;
  nextAutoResumeAt?: number;
  lastDispatchAt?: number;
  autoResumeEnabled?: boolean;
  statusNote?: string;
}

export interface GoalQueueItemState {
  id: string;
  conversationId?: string;
  parentGoalId?: string;
  resumeChain?: string[];
  title?: string;
  description?: string;
  status: 'queued' | 'running' | 'paused' | 'failed' | 'completed';
  updatedAt?: number;
  createdAt?: number;
  goal?: any;
  agents?: any[];
  meta?: GoalRunMetaState;
  history?: Array<{ id: string; at: number; type: string; message: string }>;
}

export interface ActiveGoalSnapshotState {
  conversationId?: string;
  goal?: any;
  agents?: any[];
  meta?: GoalRunMetaState;
  savedAt?: number;
}

export function createGoalStateEvent(type: GoalQueueEvent['type'], message: string, at = Date.now()): GoalQueueEvent {
  return {
    id: `goal_event_${at}_${Math.random().toString(36).slice(2, 8)}`,
    at,
    type,
    message,
  };
}

export function normalizeGoalRunMeta(meta?: GoalRunMetaState): GoalRunMeta {
  const now = Date.now();
  return {
    savedAt: meta?.savedAt ?? now,
    lastHeartbeatAt: meta?.lastHeartbeatAt ?? now,
    failureCount: meta?.failureCount ?? 0,
    nextAutoResumeAt: meta?.nextAutoResumeAt,
    lastDispatchAt: meta?.lastDispatchAt,
    autoResumeEnabled: meta?.autoResumeEnabled,
    statusNote: meta?.statusNote,
  };
}

export function normalizeGoalQueueItem(item: GoalQueueItemState): GoalQueueItem {
  const goal = item.goal || {};
  const conversationId = item.conversationId || goal.conversationId || '';
  const description = item.description || goal.description || '';
  const title = item.title || description.slice(0, 80);
  const createdAt = item.createdAt || goal.createdAt || item.updatedAt || Date.now();
  const updatedAt = item.updatedAt || createdAt;

  return {
    id: item.id,
    conversationId,
    parentGoalId: item.parentGoalId,
    resumeChain: item.resumeChain,
    title,
    description,
    status: item.status,
    createdAt,
    updatedAt,
    goal: item.goal,
    agents: item.agents,
    meta: item.meta ? normalizeGoalRunMeta(item.meta) : undefined,
    history: item.history?.map((event) => ({
      ...event,
      type: event.type as GoalQueueEvent['type'],
    })),
  };
}

export function recoverInterruptedGoalState(goal: any, now = Date.now()): any {
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

export function buildRecoveredGoalFromRun(run: GoalRunState, now = Date.now()): any {
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
