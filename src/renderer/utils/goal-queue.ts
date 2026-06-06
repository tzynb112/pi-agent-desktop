import type { GoalQueueEvent, GoalQueueItem, GoalRunMeta } from '../types';
import type { Agent, Goal } from '../../shared/goal-executor';

export const GOAL_RUNNING_LEASE_MS = 90_000;

export interface GoalQueueTransition {
  status?: GoalQueueItem['status'];
  eventType: GoalQueueEvent['type'];
  note: string;
  autoResumeEnabled?: boolean;
  nextAutoResumeAt?: number;
  failureCount?: number;
}

export interface GoalQueueScheduleDecision {
  candidate?: GoalQueueItem;
  nextAutoResumeAt?: number;
  delayMs?: number;
  shouldPersistSchedule: boolean;
  reason?: 'disabled' | 'busy' | 'no_candidate' | 'locked';
}

export function clampAutoResumeDelaySeconds(delaySeconds?: number): number {
  const raw = Number(delaySeconds);
  if (!Number.isFinite(raw)) return 30;
  return Math.max(5, Math.min(3600, raw));
}

export function goalStatusToQueueStatus(status: Goal['status']): GoalQueueItem['status'] {
  if (status === 'executing' || status === 'planning') return 'running';
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'completed';
  return 'queued';
}

export function createGoalQueueEvent(type: GoalQueueEvent['type'], message: string, at = Date.now()): GoalQueueEvent {
  return {
    id: `goal_event_${at}_${Math.random().toString(36).slice(2, 8)}`,
    at,
    type,
    message,
  };
}

export function mergeGoalQueueHistory(existing: GoalQueueEvent[] = [], event?: GoalQueueEvent): GoalQueueEvent[] {
  const next = event ? [...existing, event] : existing;
  return next.slice(-12);
}

export function recoverInterruptedGoal(goal: Goal, now = Date.now()): Goal {
  if (goal.status !== 'planning' && goal.status !== 'executing') {
    return goal;
  }

  return {
    ...goal,
    status: 'failed',
    error: '应用重启后检测到上次执行中断，已保存断点，可继续目标。',
    updatedAt: now,
    subTasks: (goal.subTasks || []).map((task) =>
      task.status === 'executing'
        ? {
            ...task,
            status: 'failed',
            error: task.error || '应用重启导致该子任务中断，可从此处继续。',
          }
        : task
    ),
  };
}

export function recoverInterruptedGoalQueue(queue: GoalQueueItem[], now = Date.now()): { queue: GoalQueueItem[]; changed: boolean } {
  let changed = false;
  const next = queue.map((item) => {
    if (item.status !== 'running') return item;

    changed = true;
    const recoveredGoal = item.goal ? recoverInterruptedGoal(item.goal as Goal, now) : item.goal;
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
        autoResumeEnabled: false,
        nextAutoResumeAt: undefined,
        statusNote: '检测到上次运行中断，已转为可续跑',
      } as GoalRunMeta,
      history: mergeGoalQueueHistory(
        item.history,
        createGoalQueueEvent('recovered', '应用启动时恢复了中断的运行任务', now)
      ),
    };
  });

  return { queue: next, changed };
}

export function updateGoalQueueItemInQueue(
  queue: GoalQueueItem[],
  goalId: string,
  patch: Partial<GoalQueueItem>,
  event?: GoalQueueEvent,
  now = Date.now()
): GoalQueueItem[] {
  return queue.map((item) =>
    item.id === goalId
      ? {
          ...item,
          ...patch,
          meta: patch.meta ? ({ ...(item.meta || {}), ...patch.meta } as GoalRunMeta) : item.meta,
          history: mergeGoalQueueHistory(patch.history || item.history, event),
          updatedAt: now,
        }
      : item
  );
}

export function transitionGoalQueueItemInQueue(
  queue: GoalQueueItem[],
  goalId: string,
  transition: GoalQueueTransition,
  now = Date.now()
): GoalQueueItem[] {
  const existing = queue.find((item) => item.id === goalId);
  const mergedMeta: Partial<GoalRunMeta> = {
    ...(existing?.meta || {}),
    savedAt: now,
    lastHeartbeatAt: now,
    failureCount: existing?.meta?.failureCount || 0,
    statusNote: transition.note,
  };

  if (transition.failureCount !== undefined) {
    mergedMeta.failureCount = transition.failureCount;
  }
  if (transition.autoResumeEnabled !== undefined) {
    mergedMeta.autoResumeEnabled = transition.autoResumeEnabled;
  }
  if (transition.nextAutoResumeAt !== undefined || transition.autoResumeEnabled === false) {
    mergedMeta.nextAutoResumeAt = transition.nextAutoResumeAt;
  }

  const patch: Partial<GoalQueueItem> = {
    meta: mergedMeta as GoalRunMeta,
  };
  if (transition.status) {
    patch.status = transition.status;
  }

  return updateGoalQueueItemInQueue(
    queue,
    goalId,
    patch,
    createGoalQueueEvent(transition.eventType, transition.note, now),
    now
  );
}

export function recoverStaleRunningGoalQueue(
  queue: GoalQueueItem[],
  now = Date.now(),
  leaseMs = GOAL_RUNNING_LEASE_MS
): { queue: GoalQueueItem[]; changed: boolean; recoveredIds: string[] } {
  let changed = false;
  const recoveredIds: string[] = [];
  const next = queue.map((item) => {
    if (item.status !== 'running') return item;
    const heartbeatAt = item.meta?.lastHeartbeatAt || item.updatedAt || item.createdAt;
    if (now - heartbeatAt < leaseMs) return item;

    changed = true;
    recoveredIds.push(item.id);
    const recoveredGoal = item.goal ? recoverInterruptedGoal(item.goal as Goal, now) : item.goal;
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
        autoResumeEnabled: false,
        nextAutoResumeAt: undefined,
        statusNote: '运行租约超时，已转为可续跑',
      } as GoalRunMeta,
      history: mergeGoalQueueHistory(
        item.history,
        createGoalQueueEvent('recovered', '运行租约超时，自动恢复为可续跑', now)
      ),
    };
  });

  return { queue: next, changed, recoveredIds };
}

export function getNextRunnableGoalQueueItem(queue: GoalQueueItem[]): GoalQueueItem | undefined {
  return queue
    .filter((item) => (item.status === 'queued' || item.status === 'failed') && !!item.goal)
    .sort((a, b) => {
      const aTime = a.meta?.nextAutoResumeAt || a.updatedAt || a.createdAt;
      const bTime = b.meta?.nextAutoResumeAt || b.updatedAt || b.createdAt;
      if (aTime !== bTime) return aTime - bTime;
      return (a.createdAt || 0) - (b.createdAt || 0);
    })[0];
}

export function planGoalQueueAutoResume(
  queue: GoalQueueItem[],
  options: {
    autoResumeEnabled: boolean;
    hasActiveGoal: boolean;
    isStreaming: boolean;
    lockedGoalId?: string | null;
    delaySeconds?: number;
    now?: number;
  }
): GoalQueueScheduleDecision {
  const now = options.now ?? Date.now();
  if (!options.autoResumeEnabled) {
    return { shouldPersistSchedule: false, reason: 'disabled' };
  }
  if (options.hasActiveGoal || options.isStreaming) {
    return { shouldPersistSchedule: false, reason: 'busy' };
  }

  const candidate = getNextRunnableGoalQueueItem(queue);
  if (!candidate) {
    return { shouldPersistSchedule: false, reason: 'no_candidate' };
  }
  if (options.lockedGoalId === candidate.id) {
    return { candidate, shouldPersistSchedule: false, reason: 'locked' };
  }

  const existingNextAutoResumeAt = candidate.meta?.autoResumeEnabled ? candidate.meta.nextAutoResumeAt : undefined;
  const nextAutoResumeAt = existingNextAutoResumeAt && existingNextAutoResumeAt > now
    ? existingNextAutoResumeAt
    : now + clampAutoResumeDelaySeconds(options.delaySeconds) * 1000;
  const delayMs = Math.max(0, nextAutoResumeAt - now);

  return {
    candidate,
    nextAutoResumeAt,
    delayMs,
    shouldPersistSchedule: !candidate.meta?.autoResumeEnabled || candidate.meta?.nextAutoResumeAt !== nextAutoResumeAt,
  };
}

export function buildResumeSourceFromGoal(
  queue: GoalQueueItem[],
  conversationId: string,
  goal: Goal,
  agents: Agent[] = [],
  meta?: GoalRunMeta | null,
  now = Date.now()
): { item: GoalQueueItem; queue: GoalQueueItem[] } {
  const existing = queue.find((item) => item.id === goal.id);
  if (existing) return { item: existing, queue };

  const item: GoalQueueItem = {
    id: goal.id,
    conversationId,
    title: goal.description.slice(0, 80),
    description: goal.description,
    status: goalStatusToQueueStatus(goal.status),
    createdAt: goal.createdAt || now,
    updatedAt: goal.updatedAt || now,
    goal,
    agents,
    meta: meta || {
      savedAt: now,
      lastHeartbeatAt: now,
      failureCount: goal.status === 'failed' ? 1 : 0,
      statusNote: '续跑来源已保存',
    },
    history: [createGoalQueueEvent('created', '续跑来源已保存', now)],
  };

  return { item, queue: [item, ...queue] };
}

export function markResumeSourceTransferredInQueue(
  queue: GoalQueueItem[],
  source: GoalQueueItem,
  targetGoalId?: string,
  now = Date.now()
): GoalQueueItem[] {
  const message = targetGoalId
    ? `已移交给续跑目标 ${targetGoalId}`
    : '续跑已启动，等待新目标接管';
  return transitionGoalQueueItemInQueue(queue, source.id, {
    status: 'completed',
    eventType: 'auto_resume',
    note: message,
    autoResumeEnabled: false,
  }, now);
}

export function inheritResumeSourceInQueue(
  queue: GoalQueueItem[],
  newGoalId: string,
  source: GoalQueueItem,
  now = Date.now()
): GoalQueueItem[] {
  const sourceChain = source.resumeChain || [];
  const nextChain = [...sourceChain, source.id].slice(-8);
  const sourceHistory = source.history || [];
  const inheritedEvent = createGoalQueueEvent('recovered', `继承续跑来源 ${source.id}`, now);

  return queue.map((item) =>
    item.id === newGoalId
      ? {
          ...item,
          parentGoalId: source.id,
          resumeChain: nextChain,
          history: mergeGoalQueueHistory([...sourceHistory, ...(item.history || [])], inheritedEvent),
        }
      : item
  );
}
