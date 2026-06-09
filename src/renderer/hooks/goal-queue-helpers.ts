import { GoalQueueItem, GoalQueueEvent, GoalRunMeta } from '../types';
import type { Goal, Agent } from '../../shared/goal-executor';
import { getWorkspacePath, getWorkspaceStorageKey } from '../utils/workspace-context';
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

const ACTIVE_GOAL_STORAGE_BASE_KEY = 'piano-active-goal';
const GOAL_QUEUE_STORAGE_BASE_KEY = 'piano-goal-queue';
const ACTIVE_GOAL_APP_STATE_BASE_KEY = 'active-goal';
const GOAL_QUEUE_APP_STATE_BASE_KEY = 'goal-queue';

function resolveWorkspacePath(workspacePath?: string | null): string | null {
  return workspacePath ?? getWorkspacePath();
}

export function getActiveGoalStorageKey(workspacePath?: string | null): string {
  return getWorkspaceStorageKey(ACTIVE_GOAL_STORAGE_BASE_KEY, resolveWorkspacePath(workspacePath));
}

export function getGoalQueueStorageKey(workspacePath?: string | null): string {
  return getWorkspaceStorageKey(GOAL_QUEUE_STORAGE_BASE_KEY, resolveWorkspacePath(workspacePath));
}

export function getActiveGoalAppStateKey(workspacePath?: string | null): string {
  return getWorkspaceStorageKey(ACTIVE_GOAL_APP_STATE_BASE_KEY, resolveWorkspacePath(workspacePath));
}

export function getGoalQueueAppStateKey(workspacePath?: string | null): string {
  return getWorkspaceStorageKey(GOAL_QUEUE_APP_STATE_BASE_KEY, resolveWorkspacePath(workspacePath));
}

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

export function recoverInterruptedGoalQueue(queue: GoalQueueItem[], workspacePath?: string | null): GoalQueueItem[] {
  const result = recoverInterruptedGoalQueueInMemory(queue);

  if (result.changed) {
    saveGoalQueue(result.queue, workspacePath);
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

export function clearActiveGoalSnapshot(workspacePath?: string | null): void {
  localStorage.removeItem(getActiveGoalStorageKey(workspacePath));
  removeAppState(getActiveGoalAppStateKey(workspacePath));
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

export function loadGoalQueue(recoverInterrupted = false, workspacePath?: string | null): GoalQueueItem[] {
  try {
    const raw = localStorage.getItem(getGoalQueueStorageKey(workspacePath));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return recoverInterrupted ? recoverInterruptedGoalQueue(parsed, workspacePath) : parsed;
  } catch {
    localStorage.removeItem(getGoalQueueStorageKey(workspacePath));
    return [];
  }
}

export function saveGoalQueue(queue: GoalQueueItem[], workspacePath?: string | null): void {
  const trimmed = queue.slice(0, 20);
  localStorage.setItem(getGoalQueueStorageKey(workspacePath), JSON.stringify(trimmed));
  persistAppState(getGoalQueueAppStateKey(workspacePath), trimmed);
}

export function upsertGoalQueueItem(
  conversationId: string,
  goal: Goal,
  agents: Agent[],
  meta: GoalRunMeta,
  statusOverride?: GoalQueueItem['status'],
  event?: GoalQueueEvent,
  workspacePath?: string | null
): GoalQueueItem[] {
  const queue = loadGoalQueue(false, workspacePath);
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

  saveGoalQueue(next, workspacePath);
  return next;
}

export function removeGoalQueueItem(goalId: string, workspacePath?: string | null): GoalQueueItem[] {
  const next = loadGoalQueue(false, workspacePath).filter((item) => item.id !== goalId);
  saveGoalQueue(next, workspacePath);
  return next;
}

export function removeGoalQueueItemsForConversation(conversationId: string, workspacePath?: string | null): GoalQueueItem[] {
  const next = loadGoalQueue(false, workspacePath).filter((item) => item.conversationId !== conversationId);
  saveGoalQueue(next, workspacePath);
  return next;
}

export function updateGoalQueueItem(goalId: string, patch: Partial<GoalQueueItem>, event?: GoalQueueEvent, workspacePath?: string | null): GoalQueueItem[] {
  const next = updateGoalQueueItemInQueue(loadGoalQueue(false, workspacePath), goalId, patch, event);
  saveGoalQueue(next, workspacePath);
  return next;
}

export function transitionGoalQueueItem(goalId: string, transition: GoalQueueTransition, workspacePath?: string | null): GoalQueueItem[] {
  const next = transitionGoalQueueItemInQueue(loadGoalQueue(false, workspacePath), goalId, transition);
  saveGoalQueue(next, workspacePath);
  return next;
}

export function recoverStaleRunningGoalQueue(now = Date.now(), leaseMs = GOAL_RUNNING_LEASE_MS, workspacePath?: string | null): { queue: GoalQueueItem[]; changed: boolean; recoveredIds: string[] } {
  const result = recoverStaleRunningGoalQueueInMemory(loadGoalQueue(false, workspacePath), now, leaseMs);

  if (result.changed) {
    saveGoalQueue(result.queue, workspacePath);
  }
  return result;
}

export function buildResumeSourceFromGoal(
  conversationId: string,
  goal: Goal,
  agents: Agent[] = [],
  meta?: GoalRunMeta | null,
  workspacePath?: string | null
): GoalQueueItem {
  const result = buildResumeSourceFromGoalInQueue(loadGoalQueue(false, workspacePath), conversationId, goal, agents, meta);
  saveGoalQueue(result.queue, workspacePath);
  return result.item;
}

export function markResumeSourceTransferred(source: GoalQueueItem, targetGoalId?: string, workspacePath?: string | null): GoalQueueItem[] {
  const next = markResumeSourceTransferredInQueue(loadGoalQueue(false, workspacePath), source, targetGoalId);
  saveGoalQueue(next, workspacePath);
  return next;
}

export function mergeGoalQueueItem(item: GoalQueueItem, workspacePath?: string | null): GoalQueueItem[] {
  const queue = loadGoalQueue(false, workspacePath);
  const exists = queue.some((queueItem) => queueItem.id === item.id);
  const next = exists
    ? queue.map((queueItem) => queueItem.id === item.id ? item : queueItem)
    : [item, ...queue];
  saveGoalQueue(next, workspacePath);
  return next;
}

export async function completeResumeSource(source: GoalQueueItem, targetGoalId?: string, workspacePath?: string | null): Promise<GoalQueueItem[]> {
  const completed = await window.electronAPI?.completeGoalQueueItem?.(source.id, targetGoalId).catch(() => null);
  if (completed) {
    return mergeGoalQueueItem(completed, workspacePath);
  }
  return markResumeSourceTransferred(source, targetGoalId, workspacePath);
}

export async function failResumeSource(source: GoalQueueItem, note: string, workspacePath?: string | null): Promise<GoalQueueItem[]> {
  const failed = await window.electronAPI?.failGoalQueueItem?.(source.id, note).catch(() => null);
  if (failed) {
    return mergeGoalQueueItem(failed, workspacePath);
  }
  return transitionGoalQueueItem(source.id, {
    status: 'failed',
    eventType: 'failed',
    note,
    failureCount: (source.meta?.failureCount || 0) + 1,
    autoResumeEnabled: false,
  }, workspacePath);
}

export function inheritResumeSource(newGoalId: string, source: GoalQueueItem, workspacePath?: string | null): GoalQueueItem[] {
  const next = inheritResumeSourceInQueue(loadGoalQueue(false, workspacePath), newGoalId, source);
  saveGoalQueue(next, workspacePath);
  return next;
}
