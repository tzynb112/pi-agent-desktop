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

export interface GoalVerificationSummary {
  totalChangedTasks: number;
  verifiedChangedTasks: number;
  pendingVerificationTasks: number;
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

export function normalizeGoalSnapshot(goal: any): any {
  if (!goal) return goal;
  return {
    ...goal,
    subTasks: Array.isArray(goal.subTasks)
      ? goal.subTasks.map((task: any) => ({
          ...task,
          dependencies: Array.isArray(task.dependencies) ? [...task.dependencies] : [],
          filesChanged: Array.isArray(task.filesChanged) ? [...task.filesChanged] : [],
          verificationEvidence: Array.isArray(task.verificationEvidence) ? [...task.verificationEvidence] : [],
          recentTools: Array.isArray(task.recentTools) ? [...task.recentTools] : [],
        }))
      : goal.subTasks,
  };
}

export function summarizeGoalVerification(goal: any): GoalVerificationSummary {
  const subTasks = Array.isArray(goal?.subTasks) ? goal.subTasks : [];
  const changedTasks = subTasks.filter((task: any) => Array.isArray(task.filesChanged) && task.filesChanged.length > 0);
  const verifiedChangedTasks = changedTasks.filter((task: any) => !!task.verified).length;
  return {
    totalChangedTasks: changedTasks.length,
    verifiedChangedTasks,
    pendingVerificationTasks: Math.max(0, changedTasks.length - verifiedChangedTasks),
  };
}

export function normalizeGoalQueueItem(item: GoalQueueItemState): GoalQueueItem {
  const goal = normalizeGoalSnapshot(item.goal || {});
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
    goal,
    agents: item.agents,
    meta: item.meta ? normalizeGoalRunMeta(item.meta) : undefined,
    history: item.history?.map((event) => ({
      ...event,
      type: event.type as GoalQueueEvent['type'],
    })),
  };
}

export function recoverInterruptedGoalState(goal: any, now = Date.now()): any {
  const normalizedGoal = normalizeGoalSnapshot(goal);
  if (!normalizedGoal || (normalizedGoal.status !== 'planning' && normalizedGoal.status !== 'executing')) {
    return normalizedGoal;
  }

  return {
    ...normalizedGoal,
    status: 'failed',
    error: 'Main process detected an interrupted execution and preserved a resume point.',
    updatedAt: now,
    subTasks: Array.isArray(normalizedGoal.subTasks)
      ? normalizedGoal.subTasks.map((task: any) =>
          task.status === 'executing'
            ? {
                ...task,
                status: 'failed',
                error: task.error || 'Main process detected this subtask was interrupted and kept a resume point.',
              }
            : task
        )
      : normalizedGoal.subTasks,
  };
}

export function buildRecoveredGoalFromRun(run: GoalRunState, now = Date.now()): any {
  const sourceGoal = normalizeGoalSnapshot(run.goalSnapshot || {
    id: run.goalId || `recovered_${run.id}`,
    description: run.description || 'Recovered interrupted goal',
    status: 'failed',
    createdAt: run.startedAt || now,
    updatedAt: now,
    subTasks: [],
  });
  const recoveredGoal = recoverInterruptedGoalState(sourceGoal, now);
  const baseGoal = recoveredGoal === sourceGoal && recoveredGoal.status !== 'failed'
    ? {
        ...recoveredGoal,
        status: 'failed',
        error: run.error || 'Main process detected goal run heartbeat timeout and preserved a resume point.',
        updatedAt: now,
      }
    : recoveredGoal;

  return {
    ...baseGoal,
    id: baseGoal.id || run.goalId || `recovered_${run.id}`,
    description: baseGoal.description || run.description || 'Recovered interrupted goal',
    status: 'failed',
    error: baseGoal.error || run.error || 'Main process detected goal run heartbeat timeout and preserved a resume point.',
    updatedAt: now,
    subTasks: Array.isArray(baseGoal.subTasks) ? baseGoal.subTasks : [],
  };
}
