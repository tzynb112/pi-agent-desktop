import { GoalQueueItem, GoalQueueEvent, GoalRunMeta } from '../types';
import type { Goal, Agent } from '../../shared/goal-executor';
import {
  GOAL_RUNNING_LEASE_MS,
  buildResumeSourceFromGoal as buildResumeSourceFromGoalInQueue,
  createGoalQueueEvent,
  goalStatusToQueueStatus,
  mergeGoalQueueHistory,
  recoverInterruptedGoalQueue as recoverInterruptedGoalQueueInMemory,
  recoverStaleRunningGoalQueue as recoverStaleRunningGoalQueueInMemory,
  transitionGoalQueueItemInQueue,
  updateGoalQueueItemInQueue,
  markResumeSourceTransferredInQueue,
  inheritResumeSourceInQueue,
  type GoalQueueTransition,
} from '../utils/goal-queue';
export const ACTIVE_GOAL_STORAGE_KEY = 'piano-active-goal';
export const GOAL_QUEUE_STORAGE_KEY = 'piano-goal-queue';
export const ACTIVE_GOAL_APP_STATE_KEY = 'active-goal';
export const GOAL_QUEUE_APP_STATE_KEY = 'goal-queue';

export interface ActiveGoalSnapshot {
  conversationId: string;
  goal: Goal;
  agents: Agent[];
  meta: GoalRunMeta;
  savedAt?: number;
}

export interface ResumeSource {
  item: GoalQueueItem;
  mode: 'manual' | 'auto';
}

export function goalQueueStatusLabel(status: GoalQueueItem['status']): string {
  switch (status) {
    case 'queued':
      return '排队';
    case 'running':
      return '运行';
    case 'paused':
      return '暂停';
    case 'failed':
      return '失败';
    case 'completed':
      return '完成';
    default:
      return '未知';
  }
}

export function recoverInterruptedGoalQueue(queue: GoalQueueItem[]): GoalQueueItem[] {
  const result = recoverInterruptedGoalQueueInMemory(queue);

  if (result.changed) {
    saveGoalQueue(result.queue);
  }
  return result.queue;
}

export function persistAppState(key: string, value: unknown): void {
  window.electronAPI?.writeAppState?.(key, value).catch((err) => {
    console.warn(`[AppState] Failed to persist ${key}:`, err);
  });
}

export function removeAppState(key: string): void {
  window.electronAPI?.removeAppState?.(key).catch((err) => {
    console.warn(`[AppState] Failed to remove ${key}:`, err);
  });
}

export function clearActiveGoalSnapshot(): void {
  localStorage.removeItem(ACTIVE_GOAL_STORAGE_KEY);
  removeAppState(ACTIVE_GOAL_APP_STATE_KEY);
}

export function clearTriggeredAutoResumeGoal(
  ref: React.MutableRefObject<string | null>,
  goalId?: string | null
): void {
  if (!goalId || ref.current === goalId) {
    ref.current = null;
  }
}

export function getGoalQueueFreshness(queue: GoalQueueItem[] | null | undefined): number {
  if (!queue || queue.length === 0) return 0;
  return queue.reduce((latest, item) => {
    const itemTime = item.meta?.savedAt || item.updatedAt || item.createdAt || 0;
    return Math.max(latest, itemTime);
  }, 0);
}

export function getActiveGoalSnapshotFreshness(snapshot: ActiveGoalSnapshot | null | undefined): number {
  if (!snapshot) return 0;
  return snapshot.meta?.savedAt || snapshot.goal?.updatedAt || snapshot.savedAt || 0;
}

export function loadGoalQueue(recoverInterrupted = false): GoalQueueItem[] {
  try {
    const raw = localStorage.getItem(GOAL_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return recoverInterrupted ? recoverInterruptedGoalQueue(parsed) : parsed;
  } catch {
    localStorage.removeItem(GOAL_QUEUE_STORAGE_KEY);
    return [];
  }
}

export function saveGoalQueue(queue: GoalQueueItem[]): void {
  const trimmed = queue.slice(0, 20);
  localStorage.setItem(GOAL_QUEUE_STORAGE_KEY, JSON.stringify(trimmed));
  persistAppState(GOAL_QUEUE_APP_STATE_KEY, trimmed);
}

export function upsertGoalQueueItem(
  conversationId: string,
  goal: Goal,
  agents: Agent[],
  meta: GoalRunMeta,
  statusOverride?: GoalQueueItem['status'],
  event?: GoalQueueEvent
): GoalQueueItem[] {
  const queue = loadGoalQueue();
  const now = Date.now();
  const existingIndex = queue.findIndex((item) => item.id === goal.id);
  const existingItem = existingIndex >= 0 ? queue[existingIndex] : undefined;
  const queueStatus = statusOverride || goalStatusToQueueStatus(goal.status);
  const fallbackEvent = existingItem
    ? createGoalQueueEvent(
        queueStatus === 'completed' ? 'completed' : queueStatus === 'failed' ? 'failed' : 'heartbeat',
        meta.statusNote || '目标状态已保存'
      )
    : createGoalQueueEvent('created', meta.statusNote || '目标已加入后台队列');
  const item: GoalQueueItem = {
    id: goal.id,
    conversationId,
    parentGoalId: existingItem?.parentGoalId,
    resumeChain: existingItem?.resumeChain,
    title: goal.description.slice(0, 80),
    description: goal.description,
    status: queueStatus,
    createdAt: existingIndex >= 0 ? queue[existingIndex].createdAt : goal.createdAt || now,
    updatedAt: now,
    goal,
    agents,
    meta,
    history: mergeGoalQueueHistory(existingItem?.history, event || fallbackEvent),
  };

  const next = existingIndex >= 0
    ? queue.map((oldItem, index) => (index === existingIndex ? item : oldItem))
    : [item, ...queue];

  saveGoalQueue(next);
  return next;
}

export function removeGoalQueueItem(goalId: string): GoalQueueItem[] {
  const next = loadGoalQueue().filter((item) => item.id !== goalId);
  saveGoalQueue(next);
  return next;
}

export function removeGoalQueueItemsForConversation(conversationId: string): GoalQueueItem[] {
  const next = loadGoalQueue().filter((item) => item.conversationId !== conversationId);
  saveGoalQueue(next);
  return next;
}

export function updateGoalQueueItem(goalId: string, patch: Partial<GoalQueueItem>, event?: GoalQueueEvent): GoalQueueItem[] {
  const next = updateGoalQueueItemInQueue(loadGoalQueue(), goalId, patch, event);
  saveGoalQueue(next);
  return next;
}

export function transitionGoalQueueItem(goalId: string, transition: GoalQueueTransition): GoalQueueItem[] {
  const next = transitionGoalQueueItemInQueue(loadGoalQueue(), goalId, transition);
  saveGoalQueue(next);
  return next;
}

export function recoverStaleRunningGoalQueue(now = Date.now(), leaseMs = GOAL_RUNNING_LEASE_MS): { queue: GoalQueueItem[]; changed: boolean; recoveredIds: string[] } {
  const result = recoverStaleRunningGoalQueueInMemory(loadGoalQueue(), now, leaseMs);

  if (result.changed) {
    saveGoalQueue(result.queue);
  }
  return result;
}

export function buildResumeSourceFromGoal(
  conversationId: string,
  goal: Goal,
  agents: Agent[] = [],
  meta?: GoalRunMeta | null
): GoalQueueItem {
  const result = buildResumeSourceFromGoalInQueue(loadGoalQueue(), conversationId, goal, agents, meta);
  saveGoalQueue(result.queue);
  return result.item;
}

export function markResumeSourceTransferred(source: GoalQueueItem, targetGoalId?: string): GoalQueueItem[] {
  const next = markResumeSourceTransferredInQueue(loadGoalQueue(), source, targetGoalId);
  saveGoalQueue(next);
  return next;
}

export function mergeGoalQueueItem(item: GoalQueueItem): GoalQueueItem[] {
  const queue = loadGoalQueue();
  const exists = queue.some((queueItem) => queueItem.id === item.id);
  const next = exists
    ? queue.map((queueItem) => queueItem.id === item.id ? item : queueItem)
    : [item, ...queue];
  saveGoalQueue(next);
  return next;
}

export async function completeResumeSource(source: GoalQueueItem, targetGoalId?: string): Promise<GoalQueueItem[]> {
  const completed = await window.electronAPI?.completeGoalQueueItem?.(source.id, targetGoalId).catch(() => null);
  if (completed) {
    return mergeGoalQueueItem(completed);
  }
  return markResumeSourceTransferred(source, targetGoalId);
}

export async function failResumeSource(source: GoalQueueItem, note: string): Promise<GoalQueueItem[]> {
  const failed = await window.electronAPI?.failGoalQueueItem?.(source.id, note).catch(() => null);
  if (failed) {
    return mergeGoalQueueItem(failed);
  }
  return transitionGoalQueueItem(source.id, {
    status: 'failed',
    eventType: 'failed',
    note,
    failureCount: (source.meta?.failureCount || 0) + 1,
    autoResumeEnabled: false,
  });
}

export function inheritResumeSource(newGoalId: string, source: GoalQueueItem): GoalQueueItem[] {
  const next = inheritResumeSourceInQueue(loadGoalQueue(), newGoalId, source);
  saveGoalQueue(next);
  return next;
}
