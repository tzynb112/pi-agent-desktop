import React, { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import { safeStorage } from './utils/storage';
import { electronSafe } from './utils/electron-safe';
import { ThemeProvider } from './contexts/ThemeContext';
import TitleBar from './components/TitleBar';
import { Settings, DEFAULT_SETTINGS } from './config/default-settings';
const SettingsModal = React.lazy(() => import('./components/settings/SettingsModal'));
import Sidebar from './components/sidebar/Sidebar';
import ChatArea from './components/chat/ChatArea';
import InputArea from './components/chat/InputArea';
const FileTreePanel = React.lazy(() => import('./components/filetree/FileTreePanel'));
const FileViewerPanel = React.lazy(() => import('./components/filetree/FileViewerPanel'));
import GoalStatus from './components/chat/GoalStatus';
const ExecutionPanel = React.lazy(() => import('./components/chat/ExecutionPanel'));
import { Conversation, ChatMessage, UsageStats, ToolCall, GoalRunMeta, GoalQueueEvent, GoalQueueItem } from './types';
import { PanelRight, AlertTriangle } from 'lucide-react';
import './styles/globals.css';
import './styles/layout-system.css';
import { SafetyConfirmModal } from './components/modals/SafetyConfirmModal';
import { ResizableDivider } from './components/layout/ResizableDivider';
import { callLLMApi } from './utils/llm-client';
import { buildSystemPrompt as buildSystemPromptFromConfig } from './config/system-prompt';

import { compactConversation } from './utils/compactor';

import { sanitizeAssistantDisplayContent, sanitizeChatMessage} from './utils/message-sanitize';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useUIState } from './hooks/useUIState';
import { useConversations } from './hooks/useConversations';
import { isRetryableStatus, getRetryDelay, getRetryReason } from './utils/streaming';
import type { StreamedChatCompletion, ToolCallPart } from './utils/streaming';
import { parseXmlToolCalls, shouldAllowToolCallsForUserInput } from './utils/tool-execution';
import { buildTrimmedMessages } from './utils/context-builder';
import { createToolExecState, processToolResult } from './utils/tool-exec-loop';
import { streamOnce as streamOnceApi } from './utils/stream-handler';
import { buildRequestBody } from './utils/request-builder';
import { runCompaction } from './utils/compaction-runner';
import { buildReviewPrompt } from './utils/review-builder';
import { tryParseJson } from './utils/json-heal';
import { findDangerousCommandMatch } from './utils/bash-safety';
import type { Goal, Agent } from '../shared/goal-executor';
import {
  GOAL_RUNNING_LEASE_MS,
  buildResumeSourceFromGoal as buildResumeSourceFromGoalInQueue,
  clampAutoResumeDelaySeconds,
  createGoalQueueEvent,
  goalStatusToQueueStatus,
  inheritResumeSourceInQueue,
  markResumeSourceTransferredInQueue,
  mergeGoalQueueHistory,
  planGoalQueueAutoResume,
  recoverInterruptedGoal,
  recoverInterruptedGoalQueue as recoverInterruptedGoalQueueInMemory,
  recoverStaleRunningGoalQueue as recoverStaleRunningGoalQueueInMemory,
  transitionGoalQueueItemInQueue,
  updateGoalQueueItemInQueue,
  type GoalQueueTransition,
} from './utils/goal-queue';

import {
  ACTIVE_GOAL_STORAGE_KEY, GOAL_QUEUE_STORAGE_KEY, ACTIVE_GOAL_APP_STATE_KEY, GOAL_QUEUE_APP_STATE_KEY,
  type ActiveGoalSnapshot, type ResumeSource,
  goalQueueStatusLabel, recoverInterruptedGoalQueue, persistAppState, removeAppState,
  clearActiveGoalSnapshot, clearTriggeredAutoResumeGoal, getGoalQueueFreshness, getActiveGoalSnapshotFreshness,
  loadGoalQueue, saveGoalQueue, upsertGoalQueueItem, removeGoalQueueItem, removeGoalQueueItemsForConversation,
  updateGoalQueueItem, transitionGoalQueueItem, recoverStaleRunningGoalQueue, buildResumeSourceFromGoal,
  markResumeSourceTransferred, mergeGoalQueueItem, completeResumeSource, failResumeSource, inheritResumeSource,
} from './hooks/goal-queue-helpers';




const RESTORE_FLASH_DEFAULT_STORAGE_KEY = 'piano-restored-flash-default-2026-06-01';

function saveActiveGoalSnapshot(
  conversationId: string | null,
  goal: Goal | null,
  agents: Agent[] = [],
  previousMeta?: GoalRunMeta,
  patchMeta: Partial<GoalRunMeta> = {},
  queueStatusOverride?: GoalQueueItem['status'],
  queueEvent?: GoalQueueEvent
): ActiveGoalSnapshot | null {
  if (!conversationId || !goal || goal.status === 'completed') {
    if (conversationId && goal) {
      const now = Date.now();
      upsertGoalQueueItem(conversationId, goal, agents, {
        savedAt: now,
        lastHeartbeatAt: now,
        failureCount: previousMeta?.failureCount || 0,
        statusNote: patchMeta.statusNote || '目标完成',
      }, queueStatusOverride, queueEvent || createGoalQueueEvent('completed', patchMeta.statusNote || '目标完成'));
    }
    clearActiveGoalSnapshot();
    removeAppState(ACTIVE_GOAL_APP_STATE_KEY);
    return null;
  }

  const now = Date.now();
  const failureCount = patchMeta.failureCount
    ?? previousMeta?.failureCount
    ?? (goal.status === 'failed' ? 1 : 0);
  const meta: GoalRunMeta = {
    savedAt: now,
    lastHeartbeatAt: now,
    failureCount,
    nextAutoResumeAt: patchMeta.nextAutoResumeAt ?? previousMeta?.nextAutoResumeAt,
    autoResumeEnabled: patchMeta.autoResumeEnabled ?? previousMeta?.autoResumeEnabled,
    statusNote: patchMeta.statusNote ?? previousMeta?.statusNote,
  };

  const snapshot: ActiveGoalSnapshot = {
    conversationId,
    goal,
    agents,
    meta,
  };
  safeStorage.setItem(ACTIVE_GOAL_STORAGE_KEY, JSON.stringify(snapshot));
  persistAppState(ACTIVE_GOAL_APP_STATE_KEY, snapshot);
  const status = queueStatusOverride || goalStatusToQueueStatus(goal.status);
  const derivedEvent =
    queueEvent ||
    createGoalQueueEvent(
      status === 'failed'
        ? 'failed'
        : patchMeta.nextAutoResumeAt
          ? 'scheduled'
          : patchMeta.statusNote?.includes('继续')
            ? 'manual_continue'
            : 'heartbeat',
      patchMeta.statusNote || goal.description.slice(0, 60)
    );
  upsertGoalQueueItem(conversationId, goal, agents, meta, queueStatusOverride, derivedEvent);
  return snapshot;
}

function loadActiveGoalSnapshot(): ActiveGoalSnapshot | null {
  try {
    const raw = safeStorage.getItem(ACTIVE_GOAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveGoalSnapshot;
    return normalizeActiveGoalSnapshot(parsed);
  } catch {
    clearActiveGoalSnapshot();
    return null;
  }
}

function normalizeActiveGoalSnapshot(parsed: ActiveGoalSnapshot | null): ActiveGoalSnapshot | null {
  if (!parsed?.conversationId || !parsed?.goal) return null;
  const legacySavedAt = parsed.savedAt || parsed.goal.updatedAt || Date.now();
  const recoveredGoal = recoverInterruptedGoal(parsed.goal);
  const wasInterrupted = recoveredGoal !== parsed.goal;
  return {
    ...parsed,
    goal: recoveredGoal,
    meta: {
      savedAt: wasInterrupted ? Date.now() : (parsed.meta?.savedAt ?? legacySavedAt),
      lastHeartbeatAt: wasInterrupted ? Date.now() : (parsed.meta?.lastHeartbeatAt ?? legacySavedAt),
      failureCount: wasInterrupted
        ? (parsed.meta?.failureCount || 0) + 1
        : (parsed.meta?.failureCount ?? (parsed.goal.status === 'failed' ? 1 : 0)),
      nextAutoResumeAt: wasInterrupted ? undefined : parsed.meta?.nextAutoResumeAt,
      autoResumeEnabled: wasInterrupted ? false : parsed.meta?.autoResumeEnabled,
      statusNote: wasInterrupted ? '检测到上次运行中断，已保存断点' : parsed.meta?.statusNote,
    },
  };
}

function buildResumeGoalPrompt(goal: Goal): string {
  const completed = goal.subTasks
    .filter((task) => task.status === 'completed')
    .map((task, index) => `${index + 1}. ${task.description}\n结果: ${task.result || '已完成'}`)
    .join('\n\n');

  const remaining = goal.subTasks
    .filter((task) => task.status !== 'completed')
    .map((task, index) => `${index + 1}. ${task.description}${task.error ? `\n上次错误: ${task.error}` : ''}`)
    .join('\n\n');

  return [
    '/goal 继续执行这个未完成目标。',
    '',
    `原始目标: ${goal.description}`,
    completed ? `已完成的部分:\n${completed}` : '已完成的部分: 暂无',
    remaining ? `待继续的部分:\n${remaining}` : '待继续的部分: 请验证整体结果并收尾',
    '',
    '要求: 不要重复已完成工作。先快速确认当前文件状态，然后从待继续部分开始推进，失败时自动换策略继续。',
  ].join('\n\n');
}



const STORAGE_KEYS = {
  CONVERSATIONS: 'piano-conversations',
  SETTINGS: 'piano-settings',
};
const DEFAULT_CONVERSATION_TITLE = '新会话';
const TOKEN_ESTIMATION_MULTIPLIER = 0.35;
const TOKEN_COMPLETION_MULTIPLIER = 1.3;
const MAX_TITLE_LENGTH = 40;

const App: React.FC = () => {
  const { conversations, setConversations, activeConversationId, setActiveConversationId, conversationsRef, saveConversations, getActiveBranchMessages, updateConversation } = useConversations();


  const [isStreaming, setIsStreaming] = useState(false);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const {
    sidebarCollapsed, setSidebarCollapsed,
    fileTreeCollapsed, setFileTreeCollapsed,
    fileTreeWidth, setFileTreeWidth,
    sidebarWidth, setSidebarWidth,
    fileViewerWidth, setFileViewerWidth,
    viewingFilePath, setViewingFilePath,
    viewingFileContent, setViewingFileContent,
    settingsOpen, setSettingsOpen,
    initialUIState,
    isResizingRef,
    isSidebarResizingRef,
    isFileViewerResizingRef,
  } = useUIState();
  const [safetyConfirm, setSafetyConfirm] = useState<{
    isOpen: boolean;
    cmd: string;
    matchedKeyword: string;
    resolve: (approved: boolean) => void;
  } | null>(null);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [apiSettings, setApiSettings] = useState<Settings>(() => {
    const saved = safeStorage.getItem(STORAGE_KEYS.SETTINGS);
    let settingsObj = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    if (settingsObj.trustMode && !settingsObj.trustModeConfirmed) {
      settingsObj = {
        ...settingsObj,
        trustMode: false,
        trustModeConfirmed: false,
      };
      try {
        safeStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settingsObj));
      } catch (e) {
        console.error('[App] Failed to migrate trust mode settings:', e);
      }
    }
    
    if (!settingsObj.modelProfiles || settingsObj.modelProfiles.length === 0) {
      const defaultProfile = {
        id: 'profile_default',
        name: '默认配置 (' + (settingsObj.model || 'Unknown') + ')',
        baseURL: settingsObj.baseURL || DEFAULT_SETTINGS.baseURL || 'https://api.deepseek.com/v1',
        apiKey: settingsObj.apiKey || DEFAULT_SETTINGS.apiKey || '',
        model: settingsObj.model || DEFAULT_SETTINGS.model || 'deepseek-v4-flash',
        reasoningEffort: settingsObj.reasoningEffort || DEFAULT_SETTINGS.reasoningEffort || 'none',
        temperature: settingsObj.temperature !== undefined ? settingsObj.temperature : (DEFAULT_SETTINGS.temperature ?? 0.7),
        maxTokens: settingsObj.maxTokens !== undefined ? settingsObj.maxTokens : (DEFAULT_SETTINGS.maxTokens ?? 4096),
      };
      settingsObj = {
        ...settingsObj,
        modelProfiles: [defaultProfile],
        activeModelProfileId: 'profile_default',
      };
      try {
        safeStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settingsObj));
      } catch (e) {
        console.error('[App] Failed to save auto-initialized settings:', e);
      }
    }
    const shouldRestoreFlashDefault =
      !safeStorage.getItem(RESTORE_FLASH_DEFAULT_STORAGE_KEY) &&
      settingsObj.model === 'deepseek-v4-pro';
    if (shouldRestoreFlashDefault) {
      settingsObj = {
        ...settingsObj,
        model: 'deepseek-v4-flash',
        modelProfiles: (settingsObj.modelProfiles || []).map((profile: any) =>
          profile.id === settingsObj.activeModelProfileId
            ? {
                ...profile,
                model: 'deepseek-v4-flash',
                name: profile.name?.includes('deepseek-v4-pro')
                  ? profile.name.replace('deepseek-v4-pro', 'deepseek-v4-flash')
                  : profile.name,
              }
            : profile
        ),
      };
      try {
        safeStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settingsObj));
        safeStorage.setItem(RESTORE_FLASH_DEFAULT_STORAGE_KEY, '1');
      } catch (e) {
        console.error('[App] Failed to restore flash default settings:', e);
      }
    }
    return settingsObj;
  });

  const isStreamingRef = useRef(false);
  const [mcpTools, setMcpTools] = useState<any[]>([]);
  const [currentGoal, setCurrentGoal] = useState<Goal | null>(null);
  const [currentGoalConversationId, setCurrentGoalConversationId] = useState<string | null>(null);
  const [goalAgents, setGoalAgents] = useState<Agent[]>([]);
  const [goalRunMeta, setGoalRunMeta] = useState<GoalRunMeta | null>(null);
  const [goalQueue, setGoalQueue] = useState<GoalQueueItem[]>(() => loadGoalQueue(true));

  const clearGoalState = useCallback(() => {
    setCurrentGoal(null);
    setCurrentGoalConversationId(null);
    setGoalAgents([]);
    setGoalRunMeta(null);
  }, []);  const [draftPrompt, setDraftPrompt] = useState<{ id: number; text: string } | null>(null);

  // Execution panel visibility states
  const [executionPanelDismissed, setExecutionPanelDismissed] = useState(false);
  const prevGoalIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isStreaming) {
      setExecutionPanelDismissed(false);
    }
  }, [isStreaming]);

  useEffect(() => {
    if (currentGoal) {
      if (prevGoalIdRef.current !== currentGoal.id) {
        setExecutionPanelDismissed(false);
      }
      prevGoalIdRef.current = currentGoal.id;
    } else {
      prevGoalIdRef.current = null;
    }
  }, [currentGoal]);

  const liveOutputPersistTimerRef = useRef<NodeJS.Timeout | null>(null);
  const goalRunHeartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoResumeTriggeredGoalIdRef = useRef<string | null>(null);
  const queueSchedulerTriggeredRef = useRef<string | null>(null);
  const queueHeartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const queueDispatchExecutorRef = useRef<((goalId: string) => Promise<void>) | null>(null);
  const activeGoalDispatchExecutorRef = useRef<((goalId?: string, conversationId?: string) => Promise<void>) | null>(null);
  const activeGoalRunIdRef = useRef<string | null>(null);
  const activeGoalProgressMsgIdRef = useRef<string | null>(null);
  const pendingResumeSourceRef = useRef<ResumeSource | null>(null);
  const toolResultCacheRef = useRef<Map<string, { result: string; at: number }>>(new Map());
  const linkedResumeGoalIdsRef = useRef<Set<string>>(new Set());

  // Safety confirmation keyboard listener
  useEffect(() => {
    if (!safetyConfirm) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Skip if typing in an input/textarea
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'a' || key === 'y') {
        e.preventDefault();
        safetyConfirm.resolve(true);
      } else if (key === 'b' || key === 'n' || e.key === 'Escape') {
        e.preventDefault();
        safetyConfirm.resolve(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [safetyConfirm]);

  // --- State Persistence ---

  // -------------------------

  const stopQueueHeartbeat = useCallback(() => {
    if (queueHeartbeatTimerRef.current) {
      clearInterval(queueHeartbeatTimerRef.current);
      queueHeartbeatTimerRef.current = null;
    }
  }, []);
  const mergeQueueHeartbeatItem = useCallback((heartbeatItem: GoalQueueItem | null) => {
    if (!heartbeatItem) return;
    const nextQueue = loadGoalQueue().map((item) => item.id === heartbeatItem.id ? heartbeatItem : item).slice(0, 20);
    safeStorage.setItem(GOAL_QUEUE_STORAGE_KEY, JSON.stringify(nextQueue));
    persistAppState(GOAL_QUEUE_APP_STATE_KEY, nextQueue);
    setGoalQueue(nextQueue);
  }, []);
  const startQueueHeartbeat = useCallback((goalId: string) => {
    stopQueueHeartbeat();
    if (!window.electronAPI?.heartbeatGoalQueueItem) return;

    void window.electronAPI.heartbeatGoalQueueItem(goalId).then(mergeQueueHeartbeatItem);
    queueHeartbeatTimerRef.current = setInterval(() => {
      void window.electronAPI?.heartbeatGoalQueueItem?.(goalId).then(mergeQueueHeartbeatItem);
    }, Math.max(10_000, Math.floor(GOAL_RUNNING_LEASE_MS / 3)));
  }, [mergeQueueHeartbeatItem, stopQueueHeartbeat]);

  const releaseQueueSchedulerLock = useCallback((goalId?: string) => {
    if (!goalId || queueSchedulerTriggeredRef.current === goalId) {
      stopQueueHeartbeat();
      queueSchedulerTriggeredRef.current = null;
    }
  }, [stopQueueHeartbeat]);
  const stopGoalRunHeartbeat = useCallback(() => {
    if (goalRunHeartbeatTimerRef.current) {
      clearInterval(goalRunHeartbeatTimerRef.current);
      goalRunHeartbeatTimerRef.current = null;
    }
  }, []);


  useEffect(() => {
    return () => {
      stopQueueHeartbeat();
      stopGoalRunHeartbeat();
    };
  }, [stopGoalRunHeartbeat, stopQueueHeartbeat]);

  useEffect(() => {
    const snapshot = loadActiveGoalSnapshot();
    if (!snapshot) return;

    const conversationExists = conversationsRef.current.some((c) => c.id === snapshot.conversationId);
    if (!conversationExists || snapshot.goal.status === 'completed') {
      clearActiveGoalSnapshot();
      return;
    }

    setCurrentGoal(snapshot.goal);
    setCurrentGoalConversationId(snapshot.conversationId);
    setGoalAgents(snapshot.agents || []);
    setGoalRunMeta(snapshot.meta);
    setActiveConversationId(snapshot.conversationId);

    safeStorage.setItem(ACTIVE_GOAL_STORAGE_KEY, JSON.stringify(snapshot));
    persistAppState(ACTIVE_GOAL_APP_STATE_KEY, snapshot);
    setGoalQueue(
      upsertGoalQueueItem(
        snapshot.conversationId,
        snapshot.goal,
        snapshot.agents || [],
        snapshot.meta,
        undefined,
        snapshot.goal.status === 'failed'
          ? createGoalQueueEvent('recovered', '启动时恢复了中断目标，可继续执行')
          : createGoalQueueEvent('heartbeat', snapshot.meta.statusNote || '已恢复活动目标')
      )
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydratePersistentGoalState = async () => {
      const fileQueue = await window.electronAPI?.readAppState?.<GoalQueueItem[]>(GOAL_QUEUE_APP_STATE_KEY);
      const fileSnapshotRaw = await window.electronAPI?.readAppState?.<ActiveGoalSnapshot>(ACTIVE_GOAL_APP_STATE_KEY);
      const runningRun = await window.electronAPI?.readLatestRunningGoalRun?.();
      if (cancelled) return;

      if (Array.isArray(fileQueue) && getGoalQueueFreshness(fileQueue) > getGoalQueueFreshness(loadGoalQueue())) {
        const recovery = recoverInterruptedGoalQueueInMemory(fileQueue);
        const recoveredQueue = recovery.queue.slice(0, 20);
        safeStorage.setItem(GOAL_QUEUE_STORAGE_KEY, JSON.stringify(recoveredQueue));
        persistAppState(GOAL_QUEUE_APP_STATE_KEY, recoveredQueue);
        setGoalQueue(recoveredQueue);
      }

      if (runningRun?.goalSnapshot && runningRun.conversationId) {
        const recoveredGoal = recoverInterruptedGoal(runningRun.goalSnapshot as Goal);
        const failedGoal: Goal = {
          ...recoveredGoal,
          status: 'failed',
          error: recoveredGoal.error || 'Renderer 重启后从主进程运行快照恢复，已保存断点。',
          updatedAt: Date.now(),
        };
        const recoveredMeta: GoalRunMeta = {
          savedAt: Date.now(),
          lastHeartbeatAt: Date.now(),
          failureCount: 1,
          autoResumeEnabled: false,
          statusNote: 'Renderer 重启后从主进程运行快照恢复断点',
        };
        const snapshot: ActiveGoalSnapshot = {
          conversationId: runningRun.conversationId,
          goal: failedGoal,
          agents: runningRun.agentsSnapshot || [],
          meta: recoveredMeta,
        };

        safeStorage.setItem(ACTIVE_GOAL_STORAGE_KEY, JSON.stringify(snapshot));
        persistAppState(ACTIVE_GOAL_APP_STATE_KEY, snapshot);
        setCurrentGoal(failedGoal);
        setCurrentGoalConversationId(runningRun.conversationId);
        setGoalAgents(runningRun.agentsSnapshot || []);
        setGoalRunMeta(recoveredMeta);
        setActiveConversationId(runningRun.conversationId);
        setGoalQueue(
          upsertGoalQueueItem(
            runningRun.conversationId,
            failedGoal,
            runningRun.agentsSnapshot || [],
            recoveredMeta,
            undefined,
            createGoalQueueEvent('recovered', 'Renderer 重启后从主进程运行快照恢复断点')
          )
        );
        await window.electronAPI?.failGoalRun?.(runningRun.id, 'Renderer 重启后已恢复为可续跑断点');
        return;
      }

      const fileSnapshot = normalizeActiveGoalSnapshot(fileSnapshotRaw || null);
      if (!fileSnapshot) return;

      if (getActiveGoalSnapshotFreshness(fileSnapshot) <= getActiveGoalSnapshotFreshness(loadActiveGoalSnapshot())) {
        return;
      }

      const conversationExists = conversationsRef.current.some((c) => c.id === fileSnapshot.conversationId);
      if (!conversationExists || fileSnapshot.goal.status === 'completed') {
        clearActiveGoalSnapshot();
        return;
      }

      safeStorage.setItem(ACTIVE_GOAL_STORAGE_KEY, JSON.stringify(fileSnapshot));
      setCurrentGoal(fileSnapshot.goal);
      setCurrentGoalConversationId(fileSnapshot.conversationId);
      setGoalAgents(fileSnapshot.agents || []);
      setGoalRunMeta(fileSnapshot.meta);
      setGoalQueue(
        upsertGoalQueueItem(
          fileSnapshot.conversationId,
          fileSnapshot.goal,
          fileSnapshot.agents || [],
          fileSnapshot.meta,
          undefined,
          fileSnapshot.goal.status === 'failed'
            ? createGoalQueueEvent('recovered', '已从主进程状态恢复中断目标')
            : createGoalQueueEvent('heartbeat', fileSnapshot.meta.statusNote || '已从主进程状态恢复活动目标')
        )
      );
    };

    void hydratePersistentGoalState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Sanitize any active streaming state on mount to prevent ghost spinners after reloads or HMR
    setConversations((prevConvs) => {
      let changed = false;
      const updated = prevConvs.map((c: Conversation) => {
        const hasStreaming = c.messages.some((m) => m.isStreaming || (m.toolCalls && m.toolCalls.some(t => t.result === undefined)));
        if (!hasStreaming) return c;

        changed = true;
        const cleanedMessages = c.messages.map((m: ChatMessage) => {
          let msgChanged = false;
          let cleanedToolCalls = m.toolCalls;

          if (m.toolCalls && m.toolCalls.some(t => t.result === undefined)) {
            msgChanged = true;
            cleanedToolCalls = m.toolCalls.map(t => {
              if (t.result === undefined) {
                return {
                  ...t,
                  result: 'Error: 任务已被系统中止',
                };
              }
              return t;
            });
          }

          if (m.isStreaming) {
            msgChanged = true;
            return {
              ...m,
              isStreaming: false,
              content: m.content || '任务已被系统中止。',
              toolCalls: cleanedToolCalls,
            };
          }

          return msgChanged ? { ...m, toolCalls: cleanedToolCalls } : m;
        });

        return {
          ...c,
          messages: cleanedMessages,
          updatedAt: Date.now(),
        };
      });

      if (changed) {
        try {
          safeStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(updated));
        } catch (e) {
          console.error('Failed to save sanitized conversations:', e);
        }
        return updated;
      }
      return prevConvs;
    });
  }, []);

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onToolLiveOutput) {
      console.log('[App] Subscribing to tool live output...');
      const unsubscribe = window.electronAPI.onToolLiveOutput(({ toolCallId, text }) => {
        setConversations((prevConvs) => {
          const updated = prevConvs.map((c) => {
            const hasTool = c.messages.some((m) => m.toolCalls && m.toolCalls.some(tc => tc.id === toolCallId));
            if (!hasTool) return c;

            const updatedMessages = c.messages.map((m) => {
              if (m.toolCalls && m.toolCalls.some(tc => tc.id === toolCallId)) {
                const updatedToolCalls = m.toolCalls.map((tc) => {
                  if (tc.id === toolCallId) {
                    return {
                      ...tc,
                      liveOutput: sanitizeAssistantDisplayContent((tc.liveOutput || '') + text)
                    };
                  }
                  return tc;
                });
                return sanitizeChatMessage({ ...m, toolCalls: updatedToolCalls });
              }
              return sanitizeChatMessage(m);
            });
            return { ...c, messages: updatedMessages };
          });
          conversationsRef.current = updated;
          if (!liveOutputPersistTimerRef.current) {
            liveOutputPersistTimerRef.current = setTimeout(() => {
              liveOutputPersistTimerRef.current = null;
              try {
                safeStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversationsRef.current));
              } catch (e) {
                console.error('[App] Failed to persist live tool output:', e);
              }
            }, 1000);
          }
          return updated;
        });
      });
      return () => {
        if (liveOutputPersistTimerRef.current) {
          clearTimeout(liveOutputPersistTimerRef.current);
          liveOutputPersistTimerRef.current = null;
        }
        unsubscribe();
      };
    }
  }, []);

  // Listen for settings changes from config tool (AI-driven configuration)
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onSettingsChanged) {
      const unsubscribe = window.electronAPI.onSettingsChanged(({ key, value }) => {
        console.log(`[App] Settings changed by AI: ${key} =`, value);
        // Reload settings from localStorage (config tool writes to disk, we sync from there)
        try {
          const saved = safeStorage.getItem(STORAGE_KEYS.SETTINGS);
          if (saved) {
            const parsed = JSON.parse(saved);
            // The config tool writes to the file, but we need to update the in-memory state
            // For now, we reload from localStorage which is updated by the settings modal
            // The AI should also tell the user to reload if needed
          }
        } catch {}
        // Show a notification to the user
        const msg: ChatMessage = {
          id: `msg_config_${Date.now()}`,
          role: 'assistant',
          content: `⚙️ **设置已更新** — \`${key}\` 已变更为 \`${JSON.stringify(value)}\``,
          timestamp: Date.now(),
        };
        // We'll add this to the current conversation if one exists
        if (activeConversationId) {
          updateConversation(activeConversationId, (c) => ({
            messages: [...c.messages, msg],
          }));
        }
      });
      return () => unsubscribe();
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.loadMcpTools) {
      console.log('[App] Loading MCP tools for servers:', apiSettings.mcpServers);
      window.electronAPI.loadMcpTools(apiSettings.mcpServers || [])
        .then((tools) => {
          console.log('[App] Successfully loaded MCP tools:', tools);
          setMcpTools(tools);
        })
        .catch((err) => {
          console.error('[App] Failed to load MCP tools:', err);
        });
    }
  }, [apiSettings.mcpServers]);

  useEffect(() => {
    const root = document.documentElement;
    const accent = apiSettings.accentColor || '#8b5cf6';
    root.style.setProperty('--accent-primary', accent);
    root.style.setProperty('--accent-secondary', `${accent}d9`);
    root.style.setProperty('--accent-glow', `${accent}40`);

    if (apiSettings.bubbleStyle === 'glow') {
      root.style.setProperty('--assistant-border', accent);
      root.style.setProperty('--shadow-glow', `0 0 16px 2px ${accent}25`);
    } else if (apiSettings.bubbleStyle === 'glass') {
      root.style.setProperty('--assistant-border', 'rgba(255,255,255,0.08)');
      root.style.setProperty('--shadow-glow', 'none');
    } else {
      root.style.setProperty('--assistant-border', 'transparent');
      root.style.setProperty('--shadow-glow', 'none');
    }

    const density = apiSettings.interfaceDensity || 'comfortable';
    root.setAttribute('data-density', density);

    const bubble = apiSettings.bubbleStyle || 'glow';
    root.setAttribute('data-bubble', bubble);
  }, [apiSettings.accentColor, apiSettings.interfaceDensity, apiSettings.bubbleStyle]);

  const handleStop = useCallback(() => {
    releaseQueueSchedulerLock();
    const activeGoalRunId = activeGoalRunIdRef.current;
    if (activeGoalRunId) {
      void window.electronAPI?.requestGoalRunControl?.(activeGoalRunId, 'stop', '用户主动停止当前目标运行');
    }
    void window.electronAPI?.cancelActiveTools?.();
    setIsStreaming(false);
    isStreamingRef.current = false;

    // Immediately stop spinners and mark uncompleted tool calls as aborted in the UI
    if (activeConversationId) {
      updateConversation(activeConversationId, (c) => {
        const cleanedMessages = c.messages.map((m: ChatMessage) => {
          if (m.isStreaming || (m.role === 'assistant' && m.toolCalls && m.toolCalls.some((t: ToolCall) => t.result === undefined))) {
            const cleanedToolCalls = m.toolCalls?.map((t: ToolCall, idx: number, arr: ToolCall[]) => {
              if (t.result === undefined) {
                const isFirstUndefined = arr.findIndex((x: ToolCall) => x.result === undefined) === idx;
                return {
                  ...t,
                  result: isFirstUndefined
                    ? 'Error: 任务被中止 (操作可能已在后台执行)'
                    : 'Error: 任务被中止,未执行',
                };
              }
              return t;
            });
            return {
              ...m,
              content: m.content || '任务已被主动中止。',
              isStreaming: false,
              toolCalls: cleanedToolCalls,
            };
          }
          return m;
        });
        return {
          messages: cleanedMessages,
        };
      });
    }

    // Restore focus to input after stopping
    setTimeout(() => {
      window.dispatchEvent(new Event('piano-focus-input'));
    }, 50);
  }, [activeConversationId, currentGoal, currentGoalConversationId, goalAgents, goalRunMeta, releaseQueueSchedulerLock]);

  const [projectContextFiles, setProjectContextFiles] = useState<Array<{ path: string; content: string }>>([]);
  const [gitContext, setGitContext] = useState<string>('');
  const [projectInfo, setProjectInfo] = useState<string>('');

  // Load project context files and git status when rootPath changes
  useEffect(() => {
    if (!rootPath || !window.electronAPI) {
      setProjectContextFiles([]);
      setGitContext('');
      return;
    }
    let cancelled = false;
    const api = window.electronAPI;
    const loadProjectContext = async () => {
      try {
        const promptsDir = `${rootPath}\\.piano\\prompts`;
        const entries = await api.readDirectory(promptsDir);
        const mdFiles = entries.filter((e) => !e.isDirectory && e.name.endsWith('.md'));
        const files: Array<{ path: string; content: string }> = [];
        for (const entry of mdFiles.slice(0, 10)) {
          const content = await api.readFile(entry.path);
          if (content) {
            files.push({ path: entry.path, content });
          }
        }
        if (!cancelled) {
          setProjectContextFiles(files);
          if (files.length > 0) {
            console.log(`[App] Loaded ${files.length} project context files from .piano/prompts/`);
          }
        }
      } catch {
        if (!cancelled) setProjectContextFiles([]);
      }

      // Load git context (branch + short status)
      try {
        const branchResult = await api.executeTool('bash', JSON.stringify({ command: 'git rev-parse --abbrev-ref HEAD', cwd: rootPath }));
        const branch = branchResult.success && !branchResult.result?.startsWith('Error:')
          ? branchResult.result?.trim()
          : '';
        if (branch) {
          const statusResult = await api.executeTool('bash', JSON.stringify({ command: 'git status --short --branch', cwd: rootPath }));
          const status = statusResult.success && !statusResult.result?.startsWith('Error:')
            ? statusResult.result?.trim().split('\n').slice(0, 15).join('\n')
            : '';
          const gitInfo = status ? `Git branch: ${branch}\n${status}` : `Git branch: ${branch}`;
          if (!cancelled) {
            setGitContext(gitInfo);
            console.log('[App] Git context loaded:', branch);
          }
        } else {
          if (!cancelled) setGitContext('');
        }
      } catch {
        if (!cancelled) setGitContext('');
      }

      // Detect project type from key files
      try {
        const infoParts: string[] = [];
        // package.json
        const pkgRaw = await api.readFile(`${rootPath}\\package.json`);
        if (pkgRaw) {
          try {
            const pkg = JSON.parse(pkgRaw);
            infoParts.push(`Project: ${pkg.name || 'unnamed'} v${pkg.version || '?'}`);
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const frameworks: string[] = [];
            if (deps.react) frameworks.push(`React ${deps.react}`);
            if (deps.vue) frameworks.push(`Vue ${deps.vue}`);
            if (deps.angular) frameworks.push('Angular');
            if (deps.svelte) frameworks.push('Svelte');
            if (deps.next) frameworks.push(`Next.js ${deps.next}`);
            if (deps.nuxt) frameworks.push('Nuxt');
            if (deps.express) frameworks.push(`Express ${deps.express}`);
            if (deps.electron) frameworks.push(`Electron ${deps.electron}`);
            if (deps.typescript) frameworks.push(`TypeScript ${deps.typescript}`);
            if (deps.tailwindcss) frameworks.push(`TailwindCSS ${deps.tailwindcss}`);
            if (frameworks.length > 0) infoParts.push(`Stack: ${frameworks.join(', ')}`);
            const scripts = pkg.scripts ? Object.keys(pkg.scripts).join(', ') : '';
            if (scripts) infoParts.push(`Scripts: ${scripts}`);
          } catch {}
        }
        // README
        for (const name of ['README.md', 'readme.md', 'README.txt']) {
          const readme = await api.readFile(`${rootPath}\\${name}`);
          if (readme) {
            const firstLines = readme.split('\n').slice(0, 5).join(' ').substring(0, 200);
            if (firstLines.trim()) infoParts.push(`README: ${firstLines}`);
            break;
          }
        }
        // .gitignore (indicates project structure)
        const gitignore = await api.readFile(`${rootPath}\\.gitignore`);
        if (gitignore) {
          const ignores = gitignore.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 10).join(', ');
          if (ignores) infoParts.push(`Ignores: ${ignores}`);
        }
        if (!cancelled && infoParts.length > 0) {
          setProjectInfo(infoParts.join('\n'));
          console.log('[App] Project info detected:', infoParts[0]);
        }
      } catch {
        if (!cancelled) setProjectInfo('');
      }

      // Load .piano/config.json for project-level settings
      try {
        const pianoConfigRaw = await api.readFile(`${rootPath}\\.piano\\config.json`);
        if (pianoConfigRaw && !cancelled) {
          try {
            const pianoConfig = JSON.parse(pianoConfigRaw);
            // Inject customSystemPrompt as a project context file
            if (pianoConfig.customSystemPrompt) {
              const existing = projectContextFiles.find(f => f.path === '.piano/config.json');
              if (!existing) {
                // This will be picked up in the next render cycle by buildSystemPrompt
                console.log('[App] Project has custom system prompt in .piano/config.json');
              }
            }
            if (pianoConfig.model && pianoConfig.model !== apiSettings.model) {
              console.log('[App] Project config suggests model:', pianoConfig.model);
            }
            console.log('[App] Loaded .piano/config.json');
          } catch {}
        }
      } catch {}
    };
    void loadProjectContext();
    return () => { cancelled = true; };
  }, [rootPath]);

  const [pianoConfigPrompt, setPianoConfigPrompt] = useState<string>('');

  // Load .piano/config.json customSystemPrompt
  useEffect(() => {
    if (!rootPath || !window.electronAPI) { setPianoConfigPrompt(''); return; }
    let cancelled = false;
    window.electronAPI.readFile(`${rootPath}\\.piano\\config.json`).then((raw) => {
      if (cancelled || !raw) return;
      try {
        const cfg = JSON.parse(raw);
        if (!cancelled && cfg.customSystemPrompt) {
          setPianoConfigPrompt(cfg.customSystemPrompt);
          console.log('[App] Loaded project custom system prompt from .piano/config.json');
        }
      } catch {}
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [rootPath]);

  const buildSystemPrompt = useCallback(() => {
    const mergedCustom = [apiSettings.customSystemPrompt, pianoConfigPrompt].filter(Boolean).join('\n\n');
    const enabledBuiltInTools = Object.entries(apiSettings.enabledTools || { read: true, bash: true, edit: true, write: true })
      .filter(([, v]) => v)
      .map(([k]) => k);
    const alwaysAvailableTools = ['web', 'config', 'createTool', 'deleteTool', 'listTools', 'executeCustomTool'];
    return buildSystemPromptFromConfig({
      agentName: apiSettings.agentName || 'PianoAgent',
      selectedTools: Array.from(new Set([...enabledBuiltInTools, ...alwaysAvailableTools])),
      customSystemPrompt: mergedCustom || undefined,
      skills: apiSettings.skills ?? [],
      projectContextFiles,
      cwd: rootPath || undefined,
    });
  }, [apiSettings.skills, apiSettings.customSystemPrompt, apiSettings.agentName, apiSettings.enabledTools, projectContextFiles, pianoConfigPrompt, rootPath]);


  const handleSwitchBranch = useCallback((msgId: string) => {
    if (activeConversationId) {
      updateConversation(activeConversationId, (c) => {
        const childrenMap = new Map<string, string[]>();
        for (const m of c.messages) {
          if (m.parentId) {
            const list = childrenMap.get(m.parentId) || [];
            list.push(m.id);
            childrenMap.set(m.parentId, list);
          }
        }
        let leafId = msgId;
        while (true) {
          const children = childrenMap.get(leafId);
          if (!children || children.length === 0) {
            break;
          }
          leafId = children[0];
        }
        return {
          activeMessageId: leafId,
        };
      });
    }
  }, [activeConversationId, updateConversation]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;
  const visibleGoal = currentGoalConversationId === activeConversationId ? currentGoal : null;
  const visibleGoalAgents = visibleGoal ? goalAgents : [];
  const visibleGoalRunMeta = visibleGoal ? goalRunMeta : null;


  const handleNewConversation = useCallback(() => {
    const id = Date.now().toString();
    const newConv: Conversation = {
      id,
      title: DEFAULT_CONVERSATION_TITLE,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: apiSettings.model,
    };
    const currentConversations = conversationsRef.current;
    saveConversations([newConv, ...currentConversations]);
    setActiveConversationId(id);
  }, [saveConversations, apiSettings.model]);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const handleDeleteConversation = useCallback(
    (id: string) => {
      const updated = conversationsRef.current.filter((c) => c.id !== id);
      saveConversations(updated);
      if (activeConversationId === id) {
        setActiveConversationId(updated.length > 0 ? updated[0].id : null);
      }
      const snapshot = loadActiveGoalSnapshot();
      if (snapshot?.conversationId === id || currentGoalConversationId === id) {
        clearTriggeredAutoResumeGoal(autoResumeTriggeredGoalIdRef, snapshot?.goal?.id || currentGoal?.id);
        clearActiveGoalSnapshot();
        clearGoalState();
      }
      setGoalQueue(removeGoalQueueItemsForConversation(id));
    },
    [activeConversationId, currentGoalConversationId, saveConversations]
  );

  const handleResumeGoal = useCallback(() => {
    if (!currentGoal) return;
    const goalConversationId = currentGoalConversationId || activeConversationId;
    if (!goalConversationId) return;
    const resumePrompt = buildResumeGoalPrompt(currentGoal);
    const source = buildResumeSourceFromGoal(goalConversationId, currentGoal, goalAgents, goalRunMeta);
    pendingResumeSourceRef.current = { item: source, mode: 'manual' };
    clearActiveGoalSnapshot();
    autoResumeTriggeredGoalIdRef.current = currentGoal.id;
    setGoalQueue(transitionGoalQueueItem(source.id, {
      status: 'paused',
      eventType: 'manual_continue',
      note: '已生成续跑草稿，原断点保留',
      autoResumeEnabled: false,
    }));
    clearGoalState();
    setDraftPrompt({ id: Date.now(), text: resumePrompt });
    window.dispatchEvent(new Event('piano-focus-input'));
  }, [activeConversationId, currentGoal, currentGoalConversationId, goalAgents, goalRunMeta]);

  const handleDismissGoal = useCallback(() => {
    clearTriggeredAutoResumeGoal(autoResumeTriggeredGoalIdRef, currentGoal?.id);
    clearActiveGoalSnapshot();
    if (currentGoal) {
      setGoalQueue(removeGoalQueueItem(currentGoal.id));
    }
    clearGoalState();
  }, []);

  const handleOpenGoalConversation = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
  }, []);

  const handleResumeGoalQueueItem = useCallback((goalId: string) => {
    const item = loadGoalQueue().find((queueItem) => queueItem.id === goalId);
    if (!item?.goal) return;

    pendingResumeSourceRef.current = { item, mode: 'manual' };
    clearActiveGoalSnapshot();
    autoResumeTriggeredGoalIdRef.current = item.id;
    setGoalQueue(transitionGoalQueueItem(goalId, {
      status: 'paused',
      eventType: 'manual_continue',
      note: '已生成续跑草稿，等待用户发送',
      autoResumeEnabled: false,
    }));
    setActiveConversationId(item.conversationId);
    clearGoalState();
    setDraftPrompt({ id: Date.now(), text: buildResumeGoalPrompt(item.goal as Goal) });
    window.dispatchEvent(new Event('piano-focus-input'));
  }, []);

  const handlePauseGoalQueueItem = useCallback((goalId: string) => {
    releaseQueueSchedulerLock(goalId);
    const updated = transitionGoalQueueItem(goalId, {
      status: 'paused',
      eventType: 'paused',
      note: '已暂停自动续跑',
      autoResumeEnabled: false,
    });
    setGoalQueue(updated);

    if (currentGoal?.id === goalId && goalRunMeta) {
      const nextMeta = {
        ...goalRunMeta,
        nextAutoResumeAt: undefined,
        autoResumeEnabled: false,
        statusNote: '已暂停自动续跑',
      };
      setGoalRunMeta(nextMeta);
      const goalConversationId = currentGoalConversationId || activeConversationId;
      saveActiveGoalSnapshot(goalConversationId, currentGoal, goalAgents, nextMeta, {}, 'paused', createGoalQueueEvent('paused', '当前目标已暂停自动续跑'));
    }
  }, [activeConversationId, currentGoal, currentGoalConversationId, goalAgents, goalRunMeta, releaseQueueSchedulerLock]);

  const handleRemoveGoalQueueItem = useCallback((goalId: string) => {
    releaseQueueSchedulerLock(goalId);
    setGoalQueue(removeGoalQueueItem(goalId));
    if (currentGoal?.id === goalId) {
      clearActiveGoalSnapshot();
      clearGoalState();
    }
  }, [currentGoal, releaseQueueSchedulerLock]);

  useKeyboardShortcuts({
    isStreamingRef,
    handleStop,
    handleNewConversation,
    conversations,
    activeConversationId,
    setActiveConversationId,
    setSidebarCollapsed,
    setFileTreeCollapsed,
    setSettingsOpen,
    setDraftPrompt,
  });

  const executeToolCall = async (toolCall: ToolCall): Promise<string> => {
    console.log('[App] Executing tool:', toolCall.name, toolCall.arguments);
    if (!window.electronAPI) {
      return 'Error: Electron API not available';
    }

    // JSON healing: repair malformed tool arguments before execution
    let healedArgs = toolCall.arguments;
    try {
      JSON.parse(healedArgs);
    } catch {
      const { parsed, repaired } = tryParseJson(healedArgs);
      if (repaired && parsed) {
        console.log(`[JSON-Heal] Repaired malformed JSON for tool ${toolCall.name}`);
        healedArgs = JSON.stringify(parsed);
      }
    }

    // Normalize file path for consistent cache keys
    const normalizePath = (p: string) => {
      if (!p) return '';
      // Resolve to absolute path format, normalize slashes, lowercase drive letter on Windows
      let n = p.replace(/\\/g, '/').replace(/\/+/g, '/');
      // Normalize Windows drive letter to lowercase
      if (/^[A-Z]:/.test(n)) n = n[0].toLowerCase() + n.slice(1);
      // Remove trailing slash
      return n.replace(/\/$/, '');
    };

    try {
      // Configuration Tool Execution (Intercepted in Renderer)
      if (toolCall.name === 'config') {
        try {
          const args = JSON.parse(healedArgs);
          const action = args.action;
          const key = args.key;
          const value = args.value;

          if (action === 'list') {
            const listResponse = {
              model: apiSettings.model,
              baseURL: apiSettings.baseURL,
              apiKey: apiSettings.apiKey ? '********' : undefined,
              reasoningEffort: apiSettings.reasoningEffort,
              maxTokens: apiSettings.maxTokens,
              activeProfile: (apiSettings.modelProfiles || []).find(p => p.id === apiSettings.activeModelProfileId)?.name || 'default',
            };
            return JSON.stringify(listResponse, null, 2);
          }

          if (action === 'read') {
            if (!key) return 'Error: Key not specified';
            const val = (apiSettings as any)[key];
            if (val === undefined) return `Error: Config key "${key}" not found`;
            if (key === 'apiKey' && val) return '********';
            return String(val);
          }

          if (action === 'set') {
            if (!key) return 'Error: Key not specified';
            if (value === undefined) return 'Error: Value not specified';
            const newSettings = { ...apiSettings, [key]: value };
            if (newSettings.modelProfiles && newSettings.activeModelProfileId) {
              newSettings.modelProfiles = newSettings.modelProfiles.map(p => {
                if (p.id === newSettings.activeModelProfileId) {
                  const updatedProfile = { ...p, [key]: value };
                  if (key === 'model' && (p.name === '新模型配置' || p.name.startsWith('默认配置 ('))) {
                    updatedProfile.name = `默认配置 (${value})`;
                  }
                  if (key === 'model' && p.name.startsWith('默认配置 (')) {
                    updatedProfile.name = `默认配置 (${value})`;
                  }
                  if (key === 'model' && (p.name.startsWith('Default (') || p.name.includes('deepseek-v4-'))) {
                    updatedProfile.name = `Default (${value})`;
                  }
                  return updatedProfile;
                }
                return p;
              });
            }
            setApiSettings(newSettings);
            safeStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
            return `Success: Config key "${key}" set to "${value}"`;
          }
          return `Error: Unknown config action "${action}"`;
        } catch (err: any) {
          return `Error parsing config arguments: ${err.message}`;
        }
      }

      // Tool result cache for read operations (same file within 2 minutes)
      if (toolCall.name === 'read') {
        try {
          const args = JSON.parse(healedArgs);
          const cacheKey = `read:${normalizePath(args.file_path)}`;
          const cached = toolResultCacheRef.current.get(cacheKey);
          if (cached && Date.now() - cached.at < 120_000) {
            console.log('[App] Cache hit for:', cacheKey);
            return cached.result;
          }
        } catch {}
      }

      const mcpTool = mcpTools.find((t) => t.name === toolCall.name);
      if (mcpTool) {
        console.log('[App] Routed to MCP Tool Call:', toolCall.name, 'on server:', mcpTool.mcpServerId);
        const result = await window.electronAPI.executeMcpTool(mcpTool.mcpServerId, toolCall.name, healedArgs);
        console.log('[App] MCP Tool result:', result);
        if (result.success) {
          return result.result || 'Tool executed successfully';
        } else {
          return `Error: ${result.error}`;
        }
      }

      let finalArguments = healedArgs;

      // Sandbox & Command Safety Guard Integration
      if (toolCall.name === 'bash') {
        try {
          const parsedArgs = JSON.parse(healedArgs);
          const cmd = parsedArgs.command || '';
          if (rootPath && !parsedArgs.cwd) {
            parsedArgs.cwd = rootPath;
            finalArguments = JSON.stringify(parsedArgs);
          }

          // 1. High-Risk Command Guard
          const sandboxType = apiSettings.sandboxType ?? 'guard';
          const trustMode = apiSettings.trustMode ?? false;
          if (!trustMode && (sandboxType === 'guard' || sandboxType === 'docker')) {
            const matchedKeyword = findDangerousCommandMatch(cmd, apiSettings.dangerousKeywords);
            if (matchedKeyword) {
              const approved = await new Promise<boolean>((resolve) => {
                setSafetyConfirm({
                  isOpen: true,
                  cmd,
                  matchedKeyword,
                  resolve: (res) => {
                    setSafetyConfirm(null);
                    resolve(res);
                  }
                });
              });
              if (!approved) {
                return 'Error: 操作已被用户安全拦截。';
              }
            }
          }

          // 2. Docker Sandbox Wrapping
          if (sandboxType === 'docker') {
            const mountPath = rootPath ? rootPath : '.';
            const escapedMount = mountPath.replace(/\\/g, '/');
            // Wrap command inside isolated throwaway Node container
            const escapedCmd = cmd.replace(/"/g, '\\"');
            const dockerCmd = `docker run --rm -v "${escapedMount}:/workspace" -w /workspace node:18-alpine sh -c "${escapedCmd}"`;
            console.log('[App] Wrapping bash command in Docker Sandbox:', dockerCmd);
            finalArguments = JSON.stringify({ ...parsedArgs, command: dockerCmd });
          }

        } catch (parseErr) {
          console.error('[App] Failed to parse bash arguments for safety guard:', parseErr);
        }
      }

      const result = await window.electronAPI.executeTool(toolCall.name, finalArguments, toolCall.id);
      console.log('[App] Tool result:', result);
      if (result.success) {
        const output = result.result || 'Tool executed successfully';
        // Cache read results, invalidate on write/edit
        try {
          const args = JSON.parse(healedArgs);
          if (toolCall.name === 'read') {
            const cacheKey = `read:${normalizePath(args.file_path)}`;
            toolResultCacheRef.current.set(cacheKey, { result: output, at: Date.now() });
          } else if (toolCall.name === 'write' || toolCall.name === 'edit') {
            // Invalidate cache for the modified file
            const cacheKey = `read:${normalizePath(args.file_path)}`;
            toolResultCacheRef.current.delete(cacheKey);
          }
        } catch {}
        return output;
      } else {
        return `Error: ${result.error}`;
      }
    } catch (err: any) {
      console.error('[App] Tool error:', err);
      return `Error: ${err.message || 'Tool execution failed'}`;
    }
  };


  /**
   * Process simple slash commands that only create a response message.
   * Returns true if the command was handled (caller should return).
   */
  const processSimpleCommand = useCallback(
    (content: string, convId: string, currentConvs: Conversation[], currentLeafId?: string): boolean => {
      const trimmed = content.trim();

      const addMsg = (msg: ChatMessage) => {
        const updated = currentConvs.map((c: Conversation) =>
          c.id === convId ? { ...c, messages: [...c.messages, msg], activeMessageId: msg.id, updatedAt: Date.now() } : c
        );
        conversationsRef.current = updated;
        saveConversations(updated);
      };

      // /clear
      if (trimmed === '/clear' || trimmed === '/cls') {
        const updated = currentConvs.map((c: Conversation) =>
          c.id === convId ? { ...c, messages: [], updatedAt: Date.now(), activeMessageId: undefined } : c
        );
        conversationsRef.current = updated;
        saveConversations(updated);
        return true;
      }

      // /settings
      if (trimmed === '/settings' || trimmed === '/s' || trimmed === '/config') {
        setSettingsOpen(true);
        return true;
      }

      // /model (list)
      if (trimmed === '/model') {
        const profiles = apiSettings.modelProfiles || [];
        addMsg({ id: 'msg_model_' + Date.now(), role: 'assistant', content: '\ud83e\udd16 **\u5f53\u524d\u6a21\u578b**: `' + apiSettings.model + '`\n\n\u53ef\u7528\u914d\u7f6e:\n' + profiles.map((p, i) => (i+1) + '. `' + p.name + '` (' + p.model + ')').join('\n') + '\n\n\u4f7f\u7528 `/model <\u540d\u79f0>` \u5207\u6362', timestamp: Date.now(), parentId: currentLeafId });
        return true;
      }

      // /model <name|id|model|pro|flash>
      if (trimmed.startsWith('/model ')) {
        const selector = trimmed.slice('/model '.length).trim();
        if (!selector) return false;

        const profiles = apiSettings.modelProfiles || [];
        const normalizedSelector = selector.toLowerCase();
        const aliasModel =
          normalizedSelector === 'pro'
            ? 'deepseek-v4-pro'
            : normalizedSelector === 'flash'
              ? 'deepseek-v4-flash'
              : undefined;
        const matchedProfile = profiles.find((p) =>
          p.id.toLowerCase() === normalizedSelector ||
          p.name.toLowerCase() === normalizedSelector ||
          p.model.toLowerCase() === normalizedSelector
        );
        const selectedModel = matchedProfile?.model || aliasModel || selector;
        const activeProfileId = matchedProfile?.id || apiSettings.activeModelProfileId || 'profile_default';
        const updatedProfiles = matchedProfile
          ? profiles
          : profiles.length > 0
            ? profiles.map((p) => {
                if (p.id !== activeProfileId) return p;
                const shouldRenameProfile = p.model === apiSettings.model || p.id === activeProfileId;
                const nextName = shouldRenameProfile ? `默认配置 (${selectedModel})` : p.name;

                return { ...p, model: selectedModel, name: nextName };
              })
            : [{
                id: activeProfileId,
                name: `默认配置 (${selectedModel})`,
                baseURL: apiSettings.baseURL || DEFAULT_SETTINGS.baseURL,
                apiKey: apiSettings.apiKey || DEFAULT_SETTINGS.apiKey,
                model: selectedModel,
                reasoningEffort: apiSettings.reasoningEffort || DEFAULT_SETTINGS.reasoningEffort,
                temperature: apiSettings.temperature ?? DEFAULT_SETTINGS.temperature,
                maxTokens: apiSettings.maxTokens ?? DEFAULT_SETTINGS.maxTokens,
              }];
        const activeProfile = matchedProfile || updatedProfiles.find((p) => p.id === activeProfileId);
        const newSettings: Settings = {
          ...apiSettings,
          apiKey: activeProfile?.apiKey || apiSettings.apiKey,
          baseURL: activeProfile?.baseURL || apiSettings.baseURL,
          model: selectedModel,
          reasoningEffort: activeProfile?.reasoningEffort || apiSettings.reasoningEffort,
          temperature: activeProfile?.temperature ?? apiSettings.temperature,
          maxTokens: activeProfile?.maxTokens ?? apiSettings.maxTokens,
          modelProfiles: updatedProfiles,
          activeModelProfileId: activeProfileId,
        };

        setApiSettings(newSettings);
        safeStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
        addMsg({
          id: 'msg_model_set_' + Date.now(),
          role: 'assistant',
          content: `当前模型已切换为 \`${selectedModel}\`。`,
          timestamp: Date.now(),
          parentId: currentLeafId,
        });
        return true;
      }

      
      // /help
      if (trimmed === '/help' || trimmed === '/h') {
        addMsg({ id: 'msg_help_' + Date.now(), role: 'assistant', content: '\ud83d\udcd6 **\u53ef\u7528\u547d\u4ee4**\n\n| \u547d\u4ee4 | \u63cf\u8ff0 |\n|------|------|\n| `/help` | \u663e\u793a\u6b64\u5e2e\u52a9 |\n| `/clear` | \u6e05\u7a7a\u5f53\u524d\u5bf9\u8bdd |\n| `/compact` | \u624b\u52a8\u538b\u7f29\u4e0a\u4e0b\u6587 |\n| `/review` | \u4ee3\u7801\u5ba1\u67e5 |\n| `/goal <\u63cf\u8ff0>` | \u542f\u52a8\u76ee\u6807\u6267\u884c |\n| `/export` | \u5bfc\u51fa\u5bf9\u8bdd |\n| `/model` | \u5207\u6362\u6a21\u578b |\n| `/tokens` | \u7edf\u8ba1\u4fe1\u606f |\n| `/doctor` | \u73af\u5883\u8bca\u65ad |\n| `/status` | \u5f53\u524d\u72b6\u6001 |', timestamp: Date.now(), parentId: currentLeafId });
        return true;
      }

      // /doctor
      if (trimmed === '/doctor') {
        const checks: string[] = [];
        checks.push(apiSettings.apiKey ? '\u2705 API Key: \u5df2\u914d\u7f6e' : '\u274c API Key: \u672a\u914d\u7f6e');
        checks.push(apiSettings.baseURL ? '\u2705 Base URL: ' + apiSettings.baseURL : '\u274c Base URL: \u672a\u914d\u7f6e');
        checks.push(apiSettings.model ? '\u2705 Model: ' + apiSettings.model : '\u274c Model: \u672a\u914d\u7f6e');
        const mcpCount = (apiSettings as any).mcpTools?.length || 0;
        checks.push(mcpCount > 0 ? '\u2705 MCP: ' + mcpCount + ' tools' : '\u26a0\ufe0f MCP: none');
        addMsg({ id: 'msg_doctor_' + Date.now(), role: 'assistant', content: '\ud83e\udda7 **\u73af\u5883\u8bca\u65ad**\n\n' + checks.join('\n'), timestamp: Date.now(), parentId: currentLeafId });
        return true;
      }

      // /status
      if (trimmed === '/status') {
        addMsg({ id: 'msg_status_' + Date.now(), role: 'assistant', content: '\u26aa **\u72b6\u6001**: \u7a7a\u95f2', timestamp: Date.now(), parentId: currentLeafId });
        return true;
      }

      // /tokens
      if (trimmed === '/tokens' || trimmed === '/t') {
        addMsg({ id: 'msg_tokens_' + Date.now(), role: 'assistant', content: '\ud83d\udcca **Token Statistics**\n\nModel: `' + apiSettings.model + '`', timestamp: Date.now(), parentId: currentLeafId });
        return true;
      }

return false; // Not handled
    },
    [apiSettings, saveConversations, setSettingsOpen]
  );

  const handleSend = useCallback(
    async (content: string, attachments?: any[], forkFromMessageId?: string, targetConversationId?: string) => {
      let convId = targetConversationId || activeConversationId;
      let currentConvs = [...conversationsRef.current];

      // If convId is set but the conversation does not exist in currentConvs, treat it as if we need to create a new one!
      if (convId && !currentConvs.some((c: Conversation) => c.id === convId)) {
        convId = null;
      }

      if (!convId && content) {
        const id = Date.now().toString();
        // Generate a smarter title from the first message
        const firstLine = content.split('\n').find(l => l.trim()) || content;
        const cleanTitle = firstLine
          .replace(/^\/\w+\s*/, '') // strip command prefix
          .replace(/[`*_~>#\-\[\]()]/g, '') // strip markdown
          .trim();
        const title = cleanTitle.length > MAX_TITLE_LENGTH ? cleanTitle.slice(0, MAX_TITLE_LENGTH) + '...' : (cleanTitle || DEFAULT_CONVERSATION_TITLE);
        const newConv: Conversation = {
          id,
          title,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          model: apiSettings.model,
        };
        currentConvs = [newConv, ...currentConvs];
        conversationsRef.current = currentConvs;
        saveConversations(currentConvs);
        convId = id;
        setActiveConversationId(id);
      }

      if (!convId) return;

      if (!forkFromMessageId && content) {
        const activeConv = currentConvs.find((c: Conversation) => c.id === convId) || null;
        const currentLeafId = activeConv?.activeMessageId;

        let finalContent = content;

        // Try simple commands first
        if (processSimpleCommand(content, convId, currentConvs, currentLeafId)) return;



        if (content.trim() === '/compact') {
          const progressMsg: ChatMessage = {
            id: 'msg_compact_init_' + Date.now(),
            role: 'user',
            content: '\ud83d\udce6 \u542f\u52a8\u624b\u52a8\u4e0a\u4e0b\u6587\u538b\u7f29,\u6b63\u5728\u751f\u6210\u5386\u53f2\u6458\u8981...',
            timestamp: Date.now(),
            parentId: currentLeafId,
          };
          activeGoalProgressMsgIdRef.current = progressMsg.id;
          currentConvs = currentConvs.map((c: Conversation) =>
            c.id === convId ? { ...c, messages: [...c.messages, progressMsg], activeMessageId: progressMsg.id, updatedAt: Date.now() } : c
          );
          conversationsRef.current = currentConvs;
          saveConversations(currentConvs);

          const result = await runCompaction(convId, currentConvs, apiSettings, getActiveBranchMessages);
          currentConvs = result.conversations;
          conversationsRef.current = currentConvs;
          saveConversations(currentConvs);
          if (!result.success) {
            setCurrentGoal(null);
            setCurrentGoalConversationId(null);
            setGoalAgents([]);
          }
          activeGoalProgressMsgIdRef.current = null;
          return;
        }


        if (content.trim().startsWith('/review')) {
          const progressMsg: ChatMessage = {
            id: 'msg_review_init_' + Date.now(),
            role: 'user',
            content: '\ud83d\udd0d \u6267\u884c\u4ee3\u7801\u5ba1\u67e5...',
            timestamp: Date.now(),
            parentId: currentLeafId,
          };
          currentConvs = currentConvs.map((c: Conversation) => {
            if (c.id === convId) {
              return {
                ...c,
                title: c.messages.length === 0 ? '\u4ee3\u7801\u5ba1\u67e5\u62a5\u544a' : c.title,
                messages: [...c.messages, progressMsg],
                activeMessageId: progressMsg.id,
                updatedAt: Date.now(),
              };
            }
            return c;
          });
          conversationsRef.current = currentConvs;
          saveConversations(currentConvs);

          const reviewResult = await buildReviewPrompt({
            executeTool: executeToolCall,
            rootPath,
            readFile: async (p) => (await electronSafe.readFile(p)) || '',
          });
          finalContent = reviewResult.prompt;

          currentConvs = currentConvs.map((c: Conversation) => {
            if (c.id === convId) {
              const msgs = c.messages.map((m: ChatMessage) =>
                m.id === progressMsg.id ? { ...m, content: '\ud83d\udd0d \u4ee3\u7801\u5ba1\u67e5\u5f00\u59cb (\u6b63\u5728\u751f\u6210\u5ba1\u67e5\u62a5\u544a...)' } : m
              );
              return { ...c, messages: msgs };
            }
            return c;
          });
          conversationsRef.current = currentConvs;
          saveConversations(currentConvs);

        } else if (content.trim().startsWith('/goal')) {
          // Handle /goal command - multi-agent long-running goal execution
          const rawGoalDescription = content.trim().substring(5).trim();
          const resumeSource = pendingResumeSourceRef.current?.item.conversationId === convId
            ? pendingResumeSourceRef.current
            : null;
          // Use original goal description for tracking when resuming
          const goalDescription = resumeSource?.item?.goal?.description || rawGoalDescription;

          if (!goalDescription) {
            const errorMsg: ChatMessage = {
              id: `msg_goal_err_${Date.now()}`,
              role: 'assistant',
              content: '❌ **用法错误**: 请提供目标描述。\n\n示例: `/goal 创建一个完整的用户认证系统,包括注册、登录、密码重置功能`',
              timestamp: Date.now(),
              parentId: currentLeafId,
            };
            currentConvs = currentConvs.map((c: Conversation) => {
              if (c.id === convId) {
                return {
                  ...c,
                  messages: [...c.messages, errorMsg],
                  activeMessageId: errorMsg.id,
                  updatedAt: Date.now(),
                };
              }
              return c;
            });
            conversationsRef.current = currentConvs;
            saveConversations(currentConvs);
            return;
          }

          if (resumeSource) {
            pendingResumeSourceRef.current = null;
            setGoalQueue(transitionGoalQueueItem(resumeSource.item.id, {
              status: 'running',
              eventType: 'auto_resume',
              note: resumeSource.mode === 'auto' ? '自动续跑请求已发送' : '手动续跑请求已发送',
              autoResumeEnabled: false,
            }));
          }

          // Detect resume mode: existing goal snapshot with sub-tasks
          const existingGoal = resumeSource?.item?.goal as Goal | undefined;
          const isResume = !!existingGoal && Array.isArray(existingGoal.subTasks) && existingGoal.subTasks.length > 0;

          const progressMsg: ChatMessage = {
            id: `msg_goal_init_${Date.now()}`,
            role: 'user',
            content: isResume
              ? `🎯 继续执行未完成目标...\n\n**目标**: ${goalDescription}`
              : `🎯 启动目标执行系统...\n\n**目标**: ${goalDescription}`,
            timestamp: Date.now(),
            parentId: currentLeafId,
          };

          currentConvs = currentConvs.map((c: Conversation) => {
            if (c.id === convId) {
              return {
                ...c,
                title: c.messages.length === 0 ? `目标: ${goalDescription.slice(0, 30)}...` : c.title,
                messages: [...c.messages, progressMsg],
                activeMessageId: progressMsg.id,
                updatedAt: Date.now(),
              };
            }
            return c;
          });
          conversationsRef.current = currentConvs;
          saveConversations(currentConvs);
          activeGoalProgressMsgIdRef.current = progressMsg.id;

          if (window.electronAPI?.executeGoalRun) {
            setCurrentGoalConversationId(convId);
            setGoalRunMeta({
              savedAt: Date.now(),
              lastHeartbeatAt: Date.now(),
              failureCount: goalRunMeta?.failureCount || 0,
              statusNote: isResume ? '续跑目标执行已启动' : '目标执行已启动',
            });
            const mainRunResult = await window.electronAPI.executeGoalRun({
              conversationId: convId,
              description: goalDescription,
              workspacePath: rootPath || undefined,
              statusNote: isResume ? '续跑目标运行已启动' : '目标运行已启动',
              existingGoal: isResume ? existingGoal : undefined,
              agentsSnapshot: isResume ? (resumeSource!.item.agents as Agent[] || []) : undefined,
              apiSettings: {
                baseURL: apiSettings.baseURL,
                apiKey: apiSettings.apiKey,
                model: apiSettings.model,
                temperature: apiSettings.temperature,
                maxTokens: apiSettings.maxTokens,
              },
              maxConcurrentAgents: 1,
            });

            if (mainRunResult?.goal) {
              const goal = mainRunResult.goal as Goal;
              const agents = (mainRunResult.agents || []) as Agent[];
              setCurrentGoal(goal);
              setCurrentGoalConversationId(convId);
              setGoalAgents(agents);
              const finalSnapshot = saveActiveGoalSnapshot(convId, goal, agents, goalRunMeta || undefined, {
                statusNote: goal.status === 'completed' ? '目标完成' : '目标执行结束',
              }, undefined, createGoalQueueEvent(goal.status === 'completed' ? 'completed' : 'updated', goal.status === 'completed' ? '目标完成' : '目标执行结束'));
              setGoalRunMeta(finalSnapshot?.meta || null);
              if (resumeSource) {
                await completeResumeSource(resumeSource.item, goal.id);
                inheritResumeSource(goal.id, resumeSource.item);
                releaseQueueSchedulerLock(resumeSource.item.id);
              }
              setGoalQueue(loadGoalQueue());

              const statusMsg: ChatMessage = {
                id: `goal_status_${Date.now()}`,
                role: 'assistant',
                content: goal.status === 'completed'
                  ? `目标完成\n\n${goal.result || ''}`
                  : `目标执行失败\n\n${goal.error || '未知错误'}`,
                timestamp: Date.now(),
                parentId: progressMsg.id,
              };
              currentConvs = currentConvs.map((c: Conversation) => {
                if (c.id !== convId) return c;
                const msgs = c.messages.map((m: ChatMessage) =>
                  m.id === progressMsg.id ? { ...m, content: isResume ? `续跑目标执行结束: ${goalDescription}` : `目标执行结束: ${goalDescription}` } : m
                );
                return {
                  ...c,
                  messages: [...msgs, statusMsg],
                  activeMessageId: statusMsg.id,
                  updatedAt: Date.now(),
                };
              });
              conversationsRef.current = currentConvs;
              saveConversations(currentConvs);
            setTimeout(() => {
              clearGoalState();
              activeGoalProgressMsgIdRef.current = null;
            }, 5000);
              return;
            }
          }

          let latestGoalSnapshot: Goal | null = isResume ? existingGoal! : null;
          let latestGoalAgents: Agent[] = isResume ? (resumeSource!.item.agents as Agent[] || []) : [];
          let latestGoalMeta: GoalRunMeta | undefined = goalRunMeta || undefined;
          let goalRunId: string | null = null;
          const checkGoalRunControl = async () => {
            if (!goalRunId) return;
            const control = await window.electronAPI?.readGoalRunControl?.(goalRunId);
            if (!control) return;
            await window.electronAPI?.acknowledgeGoalRunControl?.(goalRunId);
            throw new Error(control.reason || `目标运行已收到 ${control.action} 控制请求`);
          };

          // Import and use GoalExecutor
          try {
            const { GoalExecutor } = await import('../shared/goal-executor');
            const run = await window.electronAPI?.startGoalRun?.({
              conversationId: convId,
              description: goalDescription,
              workspacePath: rootPath || undefined,
              statusNote: isResume ? '续跑目标运行已启动' : '目标运行已启动',
              goalSnapshot: isResume ? existingGoal : undefined,
              agentsSnapshot: isResume ? (resumeSource!.item.agents as Agent[] || []) : undefined,
            });
            goalRunId = run?.id || null;
            activeGoalRunIdRef.current = goalRunId;
            if (goalRunId) {
              stopGoalRunHeartbeat();
              goalRunHeartbeatTimerRef.current = setInterval(() => {
                void window.electronAPI?.heartbeatGoalRun?.(goalRunId!, {
                  goalId: latestGoalSnapshot?.id,
                  description: latestGoalSnapshot?.description || goalDescription,
                  statusNote: latestGoalMeta?.statusNote || '目标运行中',
                  goalSnapshot: latestGoalSnapshot,
                  agentsSnapshot: latestGoalAgents,
                });
              }, Math.max(10_000, Math.floor(GOAL_RUNNING_LEASE_MS / 3)));
            }

            const callLLM = async (prompt: string): Promise<string> => {
              await checkGoalRunControl();
              let messages: Array<{ role: string; content: string }>;
              try {
                const parsed = JSON.parse(prompt);
                messages = Array.isArray(parsed) ? parsed : [{ role: 'user', content: prompt }];
              } catch {
                messages = [{ role: 'user', content: prompt }];
              }
              const result = await callLLMApi({
                baseURL: apiSettings.baseURL,
                apiKey: apiSettings.apiKey,
                model: apiSettings.model,
                messages,
                convId,
                temperature: 0.3,
              });
              await checkGoalRunControl();
              return result;
            };

            const goalExecutor = new GoalExecutor(
              callLLM,
              async (toolName: string, args: string) => {
                await checkGoalRunControl();
                const result = await executeToolCall({
                  id: `goal_tool_${Date.now()}`,
                  name: toolName,
                  arguments: args,
                });
                await checkGoalRunControl();
                return result;
              },
              3 // Max concurrent agents
            );

            // Set up event handlers
            goalExecutor.onEvent(async (event) => {
              let statusMessage = '';
              let liveStatusMessage = '';

              // Update goal state for UI
              let updatedGoalForEvent: Goal | undefined;
              if ('goalId' in event) {
                updatedGoalForEvent = goalExecutor.getGoal(event.goalId);
                if (updatedGoalForEvent) {
                  latestGoalSnapshot = { ...updatedGoalForEvent, subTasks: updatedGoalForEvent.subTasks.map((task) => ({ ...task })) };
                  latestGoalAgents = goalExecutor.getAgentStatus().map((agent) => ({ ...agent }));
                  setCurrentGoal(latestGoalSnapshot);
                  setCurrentGoalConversationId(convId);
                  setGoalAgents(latestGoalAgents);
                  if (goalRunId) {
                    void window.electronAPI?.heartbeatGoalRun?.(goalRunId, {
                      goalId: latestGoalSnapshot.id,
                      description: latestGoalSnapshot.description,
                      statusNote: '目标状态已更新',
                      goalSnapshot: latestGoalSnapshot,
                      agentsSnapshot: latestGoalAgents,
                    });
                  }
                }
              }

              const activeTask = latestGoalSnapshot?.subTasks.find((task) => task.status === 'executing');
              switch (event.type) {
                case 'goal_created':
                  liveStatusMessage = isResume
                    ? `🎯 正在恢复目标：${goalDescription}`
                    : `🎯 已创建目标，正在准备执行：${goalDescription}`;
                  break;
                case 'goal_planning':
                  liveStatusMessage = '🧠 正在生成执行计划...';
                  break;
                case 'goal_plan_created':
                  liveStatusMessage = '🗺️ 执行计划已生成，开始分配子任务...';
                  break;
                case 'subtask_started':
                  liveStatusMessage = activeTask
                    ? `🔧 正在执行子任务：${activeTask.description}`
                    : '🔧 正在执行子任务...';
                  break;
                case 'subtask_progress':
                  liveStatusMessage = activeTask
                    ? `🔄 子任务推进中：${activeTask.description}${activeTask.progress !== undefined ? ` (${Math.round(activeTask.progress)}%)` : ''}`
                    : '🔄 子任务推进中...';
                  break;
                case 'subtask_completed':
                  liveStatusMessage = activeTask
                    ? `✅ 子任务已完成：${activeTask.description}`
                    : '✅ 子任务已完成，继续下一步...';
                  break;
                case 'subtask_failed':
                  liveStatusMessage = activeTask
                    ? `⚠️ 子任务失败：${activeTask.description}`
                    : '⚠️ 子任务失败，正在调整策略...';
                  break;
                case 'goal_completed':
                  liveStatusMessage = `🎉 目标已完成：${goalDescription}`;
                  statusMessage = `🎉 **目标完成!**\n\n${event.result}`;
                  break;
                case 'goal_failed':
                  liveStatusMessage = `❌ 目标执行失败：${goalDescription}`;
                  statusMessage = `💥 **目标失败**\n\n错误: ${event.error}`;
                  break;
              }

              switch (event.type) {
                case 'goal_planning':
                case 'goal_plan_created':
                case 'subtask_started':
                case 'subtask_progress':
                case 'subtask_completed':
                case 'subtask_failed':
                  statusMessage = '';
                  break;
              }

              if (latestGoalSnapshot) {
                const isFailureEvent = event.type === 'subtask_failed' || event.type === 'goal_failed';
                const queueEventType: GoalQueueEvent['type'] =
                  event.type === 'goal_completed'
                    ? 'completed'
                    : isFailureEvent
                      ? 'failed'
                      : 'heartbeat';
                const savedSnapshot = saveActiveGoalSnapshot(convId, latestGoalSnapshot, latestGoalAgents, latestGoalMeta, {
                  failureCount: isFailureEvent ? (latestGoalMeta?.failureCount || 0) + 1 : latestGoalMeta?.failureCount,
                  statusNote: statusMessage ? statusMessage.replace(/\*\*/g, '').split('\n')[0] : undefined,
                }, undefined, createGoalQueueEvent(queueEventType, statusMessage ? statusMessage.replace(/\*\*/g, '').split('\n')[0] : '目标状态已更新'));
                latestGoalMeta = savedSnapshot?.meta || latestGoalMeta;
                setGoalRunMeta(savedSnapshot?.meta || null);
                if (resumeSource && latestGoalSnapshot && !linkedResumeGoalIdsRef.current.has(latestGoalSnapshot.id)) {
                  linkedResumeGoalIdsRef.current.add(latestGoalSnapshot.id);
                  await completeResumeSource(resumeSource.item, latestGoalSnapshot.id);
                  inheritResumeSource(latestGoalSnapshot.id, resumeSource.item);
                  releaseQueueSchedulerLock(resumeSource.item.id);
                }
                setGoalQueue(loadGoalQueue());
              }

              if (liveStatusMessage && progressMsg?.id) {
                currentConvs = currentConvs.map((c: Conversation) => {
                  if (c.id !== convId) return c;
                  return {
                    ...c,
                    messages: c.messages.map((m: ChatMessage) =>
                      m.id === progressMsg.id ? { ...m, content: liveStatusMessage } : m
                    ),
                    activeMessageId: progressMsg.id,
                    updatedAt: Date.now(),
                  };
                });
                conversationsRef.current = currentConvs;
                saveConversations(currentConvs);
              }

              if (goalRunId) {
                void window.electronAPI?.appendGoalRunEvent?.(goalRunId, {
                  type: event.type,
                  message: statusMessage ? statusMessage.replace(/\*\*/g, '').split('\n')[0] : event.type,
                  goalId: 'goalId' in event ? event.goalId : latestGoalSnapshot?.id,
                  description: latestGoalSnapshot?.description || goalDescription,
                  statusNote: statusMessage ? statusMessage.replace(/\*\*/g, '').split('\n')[0] : undefined,
                  goalSnapshot: latestGoalSnapshot,
                  agentsSnapshot: latestGoalAgents,
                });
              }

              if (statusMessage) {
                const statusMsg: ChatMessage = {
                  id: `goal_status_${Date.now()}`,
                  role: 'assistant',
                  content: statusMessage,
                  timestamp: Date.now(),
                  parentId: progressMsg.id,
                };

                currentConvs = currentConvs.map((c: Conversation) => {
                  if (c.id === convId) {
                    return {
                      ...c,
                      messages: [...c.messages, statusMsg],
                      activeMessageId: statusMsg.id,
                      updatedAt: Date.now(),
                    };
                  }
                  return c;
                });
                conversationsRef.current = currentConvs;
                saveConversations(currentConvs);
              }
            });

            // Get project context
            const projectContext = rootPath ? {
              files: [], // Could scan directory here
              projectInfo: `项目路径: ${rootPath}`,
            } : undefined;

            // Execute goal — use resumeGoal when resuming from a snapshot with sub-tasks
            const goal = isResume
              ? await goalExecutor.resumeGoal(existingGoal!)
              : await goalExecutor.executeGoal(goalDescription, projectContext);
            stopGoalRunHeartbeat();
            activeGoalRunIdRef.current = null;
            if (goalRunId) {
              if (goal.status === 'failed') {
                await window.electronAPI?.appendGoalRunEvent?.(goalRunId, {
                  type: 'failed',
                  message: goal.error || '目标执行失败',
                  goalId: goal.id,
                  description: goal.description,
                  statusNote: goal.error || '目标执行失败',
                  goalSnapshot: goal,
                  agentsSnapshot: goalExecutor.getAgentStatus(),
                });
                await window.electronAPI?.failGoalRun?.(goalRunId, goal.error || '目标执行失败');
              } else {
                await window.electronAPI?.appendGoalRunEvent?.(goalRunId, {
                  type: 'completed',
                  message: '目标运行已完成',
                  goalId: goal.id,
                  description: goal.description,
                  statusNote: '目标运行已完成',
                  goalSnapshot: goal,
                  agentsSnapshot: goalExecutor.getAgentStatus(),
                });
                await window.electronAPI?.completeGoalRun?.(goalRunId);
              }
            }
            clearTriggeredAutoResumeGoal(autoResumeTriggeredGoalIdRef, goal.id);

            // Update goal state
            setCurrentGoal(goal);
            setCurrentGoalConversationId(convId);
            setGoalAgents(goalExecutor.getAgentStatus());
            const finalSnapshot = saveActiveGoalSnapshot(convId, goal, goalExecutor.getAgentStatus(), latestGoalMeta, {
              statusNote: goal.status === 'completed' ? '目标完成' : '目标执行结束',
            }, undefined, createGoalQueueEvent(goal.status === 'completed' ? 'completed' : 'updated', goal.status === 'completed' ? '目标完成' : '目标执行结束'));
            setGoalRunMeta(finalSnapshot?.meta || null);
            setGoalQueue(loadGoalQueue());
            
            // Update progress message
            currentConvs = currentConvs.map((c: Conversation) => {
              if (c.id === convId) {
                const msgs = c.messages.map((m: ChatMessage) =>
                  m.id === progressMsg.id ? { ...m, content: isResume ? `🎯 续跑目标完成: ${goalDescription}` : `🎯 目标执行完成: ${goalDescription}` } : m
                );
                return { ...c, messages: msgs };
              }
              return c;
            });
            conversationsRef.current = currentConvs;
            saveConversations(currentConvs);
            
            // Clear goal state after a delay
            setTimeout(() => {
              clearGoalState();
              activeGoalProgressMsgIdRef.current = null;
            }, 5000);

          } catch (err: any) {
            console.error('[Goal] Goal execution failed:', err);
            stopGoalRunHeartbeat();
            activeGoalRunIdRef.current = null;
            const runFailureSnapshot = latestGoalSnapshot as Goal | null;
            if (goalRunId) {
              await window.electronAPI?.appendGoalRunEvent?.(goalRunId, {
                type: 'failed',
                message: err.message || String(err),
                goalId: runFailureSnapshot?.id,
                description: runFailureSnapshot?.description || goalDescription,
                statusNote: '目标执行失败，已保存断点',
                goalSnapshot: runFailureSnapshot,
                agentsSnapshot: latestGoalAgents,
              });
              await window.electronAPI?.failGoalRun?.(goalRunId, err.message || String(err));
            }

            const snapshot = runFailureSnapshot;
            const failedGoalId = snapshot ? String((snapshot as Goal).id) : undefined;
            const failedGoal: Goal | null = snapshot
              ? Object.assign({}, snapshot, {
                  status: 'failed' as const,
                  error: err.message || String(err),
                  updatedAt: Date.now(),
                })
              : null;
            if (failedGoal) {
              clearTriggeredAutoResumeGoal(autoResumeTriggeredGoalIdRef, failedGoalId);
              setCurrentGoal(failedGoal);
              setCurrentGoalConversationId(convId);
              setGoalAgents(latestGoalAgents);
              const failedSnapshot = saveActiveGoalSnapshot(convId, failedGoal, latestGoalAgents, latestGoalMeta, {
                failureCount: (latestGoalMeta?.failureCount || 0) + 1,
                statusNote: '目标执行失败，已保存断点',
              }, undefined, createGoalQueueEvent('failed', `目标执行失败: ${err.message || err}`));
              setGoalRunMeta(failedSnapshot?.meta || null);
              setGoalQueue(loadGoalQueue());
              // Release scheduler lock on resume failure so queue can retry later
              if (isResume && resumeSource) {
                releaseQueueSchedulerLock(resumeSource.item.id);
              }
            } else if (resumeSource) {
              clearTriggeredAutoResumeGoal(autoResumeTriggeredGoalIdRef, resumeSource.item.id);
              setGoalQueue(await failResumeSource(resumeSource.item, `续跑启动失败: ${err.message || err}`));
              releaseQueueSchedulerLock(resumeSource.item.id);
            }

            const errorMsg: ChatMessage = {
              id: `msg_goal_err_${Date.now()}`,
              role: 'assistant',
              content: `❌ **目标执行失败**: ${err.message || err}`,
              timestamp: Date.now(),
              parentId: progressMsg.id,
            };
            currentConvs = currentConvs.map((c: Conversation) => {
              if (c.id === convId) {
                return {
                  ...c,
                  messages: [...c.messages, errorMsg],
                  activeMessageId: errorMsg.id,
                  updatedAt: Date.now(),
                };
              }
              return c;
            });
            conversationsRef.current = currentConvs;
            saveConversations(currentConvs);
            activeGoalProgressMsgIdRef.current = null;
          }

          return;

        } else {
          const userMsg: ChatMessage = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
            parentId: currentLeafId,
          };

          currentConvs = currentConvs.map((c: Conversation) => {
            if (c.id === convId) {
              const newTitle = c.messages.length === 0
                ? (() => {
                    const firstLine = content.split('\n').find(l => l.trim()) || content;
                    const clean = firstLine.replace(/^\/\w+\s*/, '').replace(/[`*_~>#\-\[\]()]/g, '').trim();
                    return clean.length > MAX_TITLE_LENGTH ? clean.slice(0, MAX_TITLE_LENGTH) + '...' : (clean || c.title);
                  })()
                : c.title;
              return {
                ...c,
                title: newTitle,
                messages: [...c.messages, userMsg],
                activeMessageId: userMsg.id,
                updatedAt: Date.now(),
              };
            }
            return c;
          });
          conversationsRef.current = currentConvs;
          saveConversations(currentConvs);
        }

        // Wait! We need to make sure the subsequent LLM execution uses this finalContent instead of standard content!
        // So we override the content parameter for the remaining loop
        content = finalContent;
      }

      // Pre-flight check: API key must be set
      if (!apiSettings.apiKey || !apiSettings.baseURL) {
        const activeConvForCheck = currentConvs.find((c: Conversation) => c.id === convId) || null;
        const errMsg: ChatMessage = {
          id: `msg_nokey_${Date.now()}`,
          role: 'assistant',
          content: '❌ **API 配置缺失**: 未设置 API Key 或 Base URL。请按 `Ctrl+Shift+S` 打开设置，配置 API Key 和 API Base URL。',
          timestamp: Date.now(),
          parentId: activeConvForCheck?.activeMessageId,
        };
        currentConvs = currentConvs.map((c: Conversation) => {
          if (c.id === convId) {
            return { ...c, messages: [...c.messages, errMsg], activeMessageId: errMsg.id, updatedAt: Date.now() };
          }
          return c;
        });
        conversationsRef.current = currentConvs;
        saveConversations(currentConvs);
        return;
      }

      setIsStreaming(true);
      isStreamingRef.current = true;
      const startTime = Date.now();
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      try {
        // Auto-compaction check
        const activeConvBefore = currentConvs.find((c: Conversation) => c.id === convId) || null;
        if (activeConvBefore) {
          const activeBranchBefore = getActiveBranchMessages(activeConvBefore);
          const totalChars = activeBranchBefore.reduce((sum: number, m: ChatMessage) => sum + (m.content || '').length, 0);

          const compactionThreshold = apiSettings.autoCompactionThreshold || 12000;
          if (totalChars > compactionThreshold) {
            console.log(`[Auto-Compaction] Active branch total character length is ${totalChars}, exceeding threshold ${compactionThreshold}. Triggering auto-compaction...`);
            try {
              const compactedConv = await compactConversation(
                activeConvBefore,
                activeBranchBefore,
                async (prompt: string) => {
                  return callLLMApi({
                    baseURL: apiSettings.baseURL,
                    apiKey: apiSettings.apiKey,
                    model: apiSettings.model,
                    messages: [{ role: 'user', content: prompt }],
                    convId,
                    temperature: 0.3,
                  });
                }
              );

              const afterChars = compactedConv.messages.reduce((sum: number, m: ChatMessage) => sum + (m.content || '').length, 0);
              currentConvs = currentConvs.map((c: Conversation) => c.id === convId ? compactedConv : c);
              conversationsRef.current = currentConvs;
              saveConversations(currentConvs);
              console.log(`[Auto-Compaction] Completed. ${totalChars} → ${afterChars} chars (saved ${totalChars - afterChars})`);
            } catch (compactErr) {
              console.error('[Auto-Compaction] Background auto-compaction failed:', compactErr);
            }
          }
        }

        const MAX_STEPS = content?.startsWith('/goal') ? 80 : 40;
        let step = 0;
        const toolExecState = createToolExecState();
        const activeConvForToolGate = currentConvs.find((c: Conversation) => c.id === convId) || null;
        const latestUserContentForToolGate = [...getActiveBranchMessages(activeConvForToolGate)]
          .reverse()
          .find((m: ChatMessage) => m.role === 'user' && !m.content.startsWith('Tool '))?.content || '';
        const hasRecentToolActivity = !!activeConvForToolGate && activeConvForToolGate.messages.slice(-6).some((m) => {
          if (m.toolCalls && m.toolCalls.length > 0) return true;
          if (m.id.startsWith('tool_res_')) return true;
          return typeof m.content === 'string' && m.content.startsWith('Tool ');
        });
        const allowToolCallsForTurn =
          shouldAllowToolCallsForUserInput(content || latestUserContentForToolGate) || hasRecentToolActivity;

        while (step < MAX_STEPS && isStreamingRef.current) {
          const activeConv = currentConvs.find((c: Conversation) => c.id === convId) || null;
          const activeBranch = getActiveBranchMessages(activeConv);

          const trimmedMessages = buildTrimmedMessages(activeBranch, buildSystemPrompt(), {
            gitContext: gitContext || undefined,
            projectInfo: projectInfo || undefined,
          });

          const assistantMsgId = `assistant_${Date.now()}_${step}`;
          const currentLeafId = activeConv?.activeMessageId;

          const assistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            isStreaming: true,
            parentId: currentLeafId,
          };

          // Append assistant message in UI
          currentConvs = currentConvs.map((c: Conversation) => {
            if (c.id === convId) {
              return {
                ...c,
                messages: [...c.messages, assistantMsg],
                activeMessageId: assistantMsgId,
                updatedAt: Date.now(),
              };
            }
            return c;
          });
          conversationsRef.current = currentConvs;
          saveConversations(currentConvs);


          // Build API request body with tools and auto-reasoning
          const analysisCallLLM = async (prompt: string): Promise<string> => {
            const result = await electronSafe.apiProxy({
              url: apiSettings.baseURL + '/chat/completions',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': convId,
                'Authorization': 'Bearer ' + apiSettings.apiKey,
              },
              body: JSON.stringify({
                model: apiSettings.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 200,
                prompt_cache_key: convId.slice(0, 64),
              }),
            });
            if (result.status !== 200) throw new Error('API error: ' + result.status);
            return JSON.parse(result.body).choices?.[0]?.message?.content || '';
          };

          const { body: requestBody } = await buildRequestBody({
            apiSettings, trimmedMessages, mcpTools, convId, analysisCallLLM,
          });

          if (!isStreamingRef.current) break;


          const updateAssistantMessage = (
            patch: Partial<ChatMessage>,
            persist = false
          ) => {
            currentConvs = currentConvs.map((c: Conversation) => {
              if (c.id === convId) {
                const msgs = c.messages.map((m: ChatMessage) =>
                  m.id === assistantMsgId ? { ...m, ...patch } : m
                );
                return { ...c, messages: msgs, updatedAt: Date.now() };
              }
              return c;
            });
            conversationsRef.current = currentConvs;
            if (persist) {
              saveConversations(currentConvs);
            } else {
              setConversations(currentConvs);
            }
          };

          const streamOnce = async (): Promise<StreamedChatCompletion> => {
            return streamOnceApi({
              baseURL: apiSettings.baseURL,
              apiKey: apiSettings.apiKey,
              convId,
              requestBody,
              onUpdate: (patch) => updateAssistantMessage(patch),
            });
          };
          const streamWithRetry = async (): Promise<StreamedChatCompletion> => {
            const maxAttempts = 5;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                if (attempt > 1) {
                  updateAssistantMessage({
                    content: `🔄 正在自动重连 (${attempt}/${maxAttempts})...`,
                    isStreaming: true,
                  });
                }
                return await streamOnce();
              } catch (err: any) {
                const status = err?.status ?? 0;
                const hasPartialContent = !!err?.partialContent;
                const shouldRetry = isRetryableStatus(status) && (!hasPartialContent || err.partialContent.length < 100) && attempt < maxAttempts && isStreamingRef.current;

                if (!shouldRetry) {
                  throw err;
                }

                const reason = getRetryReason(status);
                const delay = getRetryDelay(attempt);
                console.log(`[Stream] Retry ${attempt}/${maxAttempts}: ${reason}, waiting ${Math.round(delay)}ms`);
                updateAssistantMessage({
                  content: `🔄 ${reason}，正在自动重连 (${attempt}/${maxAttempts})...`,
                  isStreaming: true,
                });
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
            }
            throw new Error('API request failed after retries');
          };

          const streamedResponse = await streamWithRetry();

          if (!isStreamingRef.current) break;

          let fullResponse = streamedResponse.content;
          let toolCalls: ToolCall[] = streamedResponse.toolCalls;

          // Parse XML-style tool calls from text (fallback)
          if (toolCalls.length === 0 && fullResponse.trim()) {
            const xmlToolCalls = parseXmlToolCalls(fullResponse);
            console.log('[App] XML tool calls parsed:', xmlToolCalls.length, xmlToolCalls.map(t => t.name));
            if (xmlToolCalls.length > 0) {
              toolCalls.push(...xmlToolCalls);
            }
          }

          if (!allowToolCallsForTurn && toolCalls.length > 0) {
            console.log('[App] Suppressed tool calls for conversational input:', toolCalls.map(t => t.name));
            toolCalls = [];
          }

          const displayContent = sanitizeAssistantDisplayContent(fullResponse);
          const displayReasoning = streamedResponse.reasoningContent
            ? sanitizeAssistantDisplayContent(streamedResponse.reasoningContent)
            : undefined;

          // Update assistant message with content and reasoningContent
          updateAssistantMessage({
            content: displayContent,
            reasoningContent: displayReasoning,
            toolCalls: toolCalls.map(t => ({ ...t })),
            isStreaming: false,
          }, true);

          // Auto-generate title from first assistant response if title is generic
          if (step === 0 && displayContent.trim()) {
            const conv = currentConvs.find((c: Conversation) => c.id === convId);
            if (conv && (conv.title === DEFAULT_CONVERSATION_TITLE || conv.title.length < 5)) {
              const firstLine = displayContent.split('\n').find((l: string) => l.trim() && !l.startsWith('#') && !l.startsWith('```')) || displayContent;
              const cleanTitle = firstLine.replace(/[*_~`#\[\]()]/g, '').trim();
              const newTitle = cleanTitle.length > MAX_TITLE_LENGTH ? cleanTitle.slice(0, MAX_TITLE_LENGTH) + '...' : cleanTitle;
              if (newTitle) {
                currentConvs = currentConvs.map((c: Conversation) =>
                  c.id === convId ? { ...c, title: newTitle } : c
                );
                conversationsRef.current = currentConvs;
                saveConversations(currentConvs);
              }
            }
          }

          // Update tokens estimation
          totalPromptTokens += Math.floor(JSON.stringify(trimmedMessages).length * TOKEN_ESTIMATION_MULTIPLIER);
          totalCompletionTokens += Math.floor((fullResponse.length + (toolCalls.length * 100)) * TOKEN_COMPLETION_MULTIPLIER);

          // Break loop if no more tool calls
          if (toolCalls.length === 0) {
            break;
          }


          // Execute tool calls with circuit breaker + loop detection
          const localToolCalls = toolCalls.map(t => ({ ...t }));
          for (const tc of localToolCalls) {
            if (!isStreamingRef.current || toolExecState.circuitBroken) {
              tc.result = 'Error: 任务被中止，未执行';
            } else {
              const rawResult = await executeToolCall(tc);
              const processed = processToolResult(toolExecState, tc, rawResult);
              tc.result = processed.result;
              if (processed.shouldBreak) {
                toolExecState.circuitBroken = true;
                // Skip remaining tool calls in this batch
                for (const remainingTc of localToolCalls) {
                  if (remainingTc.result === undefined) {
                    remainingTc.result = 'Error: 因检测到重复调用循环，已跳过此工具调用';
                  }
                }
              }
            }

            currentConvs = currentConvs.map((c: Conversation) => {
              if (c.id === convId) {
                const msgs = c.messages.map((m: ChatMessage) =>
                  m.id === assistantMsgId
                    ? { ...m, toolCalls: localToolCalls.map(t => ({ ...t })) }
                    : m
                );
                return { ...c, messages: msgs, updatedAt: Date.now() };
              }
              return c;
            });
            conversationsRef.current = currentConvs;
            saveConversations(currentConvs);

            if (isStreamingRef.current) {
              await new Promise((r) => setTimeout(r, 100));
            }
          }

          if (!isStreamingRef.current || toolExecState.circuitBroken) break;

          const activeConvForTool = currentConvs.find((c: Conversation) => c.id === convId) || null;
          const currentLeafForTool = activeConvForTool?.activeMessageId;

          // Append tool result virtual message
          const toolResultsMessage: ChatMessage = {
            id: `tool_res_${Date.now()}`,
            role: 'user',
            content: localToolCalls.map((tc) => `Tool ${tc.name} result:\n${tc.result}`).join('\n\n'),
            timestamp: Date.now(),
            parentId: currentLeafForTool,
          };

          currentConvs = currentConvs.map((c: Conversation) => {
            if (c.id === convId) {
              return {
                ...c,
                messages: [...c.messages, toolResultsMessage],
                activeMessageId: toolResultsMessage.id,
                updatedAt: Date.now()
              };
            }
            return c;
          });
          conversationsRef.current = currentConvs;
          saveConversations(currentConvs);

          step++;
        }

        if (step >= MAX_STEPS && isStreamingRef.current) {
          const limitMsg: ChatMessage = {
            id: `msg_step_limit_${Date.now()}`,
            role: 'assistant',
            content: `⚠️ 已达到单轮最大执行步数 (${MAX_STEPS} 步)。如需继续，请发送"继续任务"。`,
            timestamp: Date.now(),
          };
          currentConvs = currentConvs.map((c: Conversation) => {
            if (c.id === convId) {
              return {
                ...c,
                messages: [...c.messages, limitMsg],
                activeMessageId: limitMsg.id,
                updatedAt: Date.now()
              };
            }
            return c;
          });
          conversationsRef.current = currentConvs;
          saveConversations(currentConvs);
        }

        const endTime = Date.now();
        setUsageStats({
          model: apiSettings.model,
          promptTokens: totalPromptTokens || Math.floor((content || '').length * TOKEN_COMPLETION_MULTIPLIER),
          completionTokens: totalCompletionTokens,
          totalTokens: (totalPromptTokens || Math.floor((content || '').length * TOKEN_COMPLETION_MULTIPLIER)) + totalCompletionTokens,
          responseTime: endTime - startTime,
        });

      } catch (error: any) {
        console.error('API/Loop Error:', error);
        const status = error?.status ?? 0;
        const errorHints: Record<number, string> = {
          401: 'API Key 无效或已过期。请在设置中检查 API Key。',
          403: '访问被拒绝。请确认 API Key 有足够权限。',
          404: '模型端点未找到。请检查 API Base URL 和模型名称。',
          429: '请求频率过高。请稍后重试，或在设置中降低请求频率。',
          500: '服务器内部错误。请稍后重试。',
          502: '网关错误。API 服务可能暂时不可用。',
          503: '服务暂时不可用。请稍后重试。',
        };
        const hint = errorHints[status] || (status === 0 ? '网络连接失败。请检查网络和 API Base URL。' : '');
        const errorMsg = hint
          ? `❌ **API 错误 (${status})**: ${hint}\n\n\`\`\`\n${error?.message || error}\n\`\`\``
          : `❌ **错误**: ${error?.message || error}`;
        currentConvs = currentConvs.map((c: Conversation) => {
          if (c.id === convId) {
            const msgs = [...c.messages];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].role === 'assistant' && msgs[i].isStreaming) {
                msgs[i] = { ...msgs[i], content: errorMsg, isStreaming: false };
                break;
              }
            }
            return { ...c, messages: msgs, updatedAt: Date.now() };
          }
          return c;
        });
        conversationsRef.current = currentConvs;
        saveConversations(currentConvs);
      } finally {
        setIsStreaming(false);
        isStreamingRef.current = false;

        if (convId) {
          // Synchronize with the absolutely latest state in case of external interruptions (like Stop)
          currentConvs = [...conversationsRef.current];

          currentConvs = currentConvs.map((c: Conversation) => {
            if (c.id === convId) {
              const cleanedMessages = c.messages.map((m: ChatMessage) => {
                if (m.isStreaming) {
                  const cleanedToolCalls = m.toolCalls?.map((t: ToolCall) => {
                    if (t.result === undefined) {
                      return {
                        ...t,
                        result: 'Error: 任务被中止,未执行',
                      };
                    }
                    return t;
                  });
                  return {
                    ...m,
                    content: m.content || '任务已被主动中止。',
                    isStreaming: false,
                    toolCalls: cleanedToolCalls,
                  };
                }
                return m;
              });
              return {
                ...c,
                messages: cleanedMessages,
                updatedAt: Date.now(),
              };
            }
            return c;
          });
          conversationsRef.current = currentConvs;
          saveConversations(currentConvs);
        }
      }
    },
    [activeConversationId, saveConversations, apiSettings, buildSystemPrompt, getActiveBranchMessages, mcpTools, releaseQueueSchedulerLock]
  );

  useEffect(() => {
    if (!apiSettings.autoResumeGoals || !currentGoal || autoResumeTriggeredGoalIdRef.current === currentGoal.id || isStreamingRef.current) {
      return;
    }
    if (goalRunMeta && goalRunMeta.autoResumeEnabled === false) {
      return;
    }
    if (currentGoal.status === 'completed' || currentGoal.status === 'executing') {
      return;
    }
    const goalConversationId = currentGoalConversationId || activeConversationId;
    if (!goalConversationId) {
      return;
    }

    const existingNextAutoResumeAt = goalRunMeta?.autoResumeEnabled ? goalRunMeta.nextAutoResumeAt : undefined;
    const nextAutoResumeAt = existingNextAutoResumeAt && existingNextAutoResumeAt > Date.now()
      ? existingNextAutoResumeAt
      : Date.now() + clampAutoResumeDelaySeconds(apiSettings.autoResumeDelaySeconds) * 1000;
    const pendingSnapshot = goalRunMeta?.nextAutoResumeAt === nextAutoResumeAt && goalRunMeta?.autoResumeEnabled
      ? null
      : saveActiveGoalSnapshot(goalConversationId, currentGoal, goalAgents, goalRunMeta || undefined, {
          nextAutoResumeAt,
          autoResumeEnabled: true,
          statusNote: '等待自动续跑',
        }, undefined, createGoalQueueEvent('scheduled', `等待自动续跑: ${new Date(nextAutoResumeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
    if (pendingSnapshot?.meta) {
      setGoalRunMeta(pendingSnapshot.meta);
      setGoalQueue(loadGoalQueue());
    }

    // Main process owns the due-time dispatch; renderer only persists the active goal schedule here.
  }, [apiSettings.autoResumeGoals, apiSettings.autoResumeDelaySeconds, activeConversationId, currentGoal, currentGoalConversationId, goalAgents, goalRunMeta]);

  useEffect(() => {
    if (!apiSettings.autoResumeGoals || currentGoal || isStreamingRef.current) {
      return;
    }

    const recoveredQueue = recoverStaleRunningGoalQueue();
    if (recoveredQueue.changed) {
      if (recoveredQueue.recoveredIds.includes(queueSchedulerTriggeredRef.current || '')) {
        queueSchedulerTriggeredRef.current = null;
      }
      setGoalQueue(recoveredQueue.queue);
      return;
    }

    const schedule = planGoalQueueAutoResume(goalQueue, {
      autoResumeEnabled: !!apiSettings.autoResumeGoals,
      hasActiveGoal: !!currentGoal,
      isStreaming: isStreamingRef.current,
      lockedGoalId: queueSchedulerTriggeredRef.current,
      delaySeconds: apiSettings.autoResumeDelaySeconds,
    });

    if (!schedule.candidate?.goal || schedule.delayMs === undefined || schedule.nextAutoResumeAt === undefined) {
      return;
    }

    const candidate = schedule.candidate;
    const nextAutoResumeAt = schedule.nextAutoResumeAt;

    if (schedule.shouldPersistSchedule) {
      setGoalQueue(transitionGoalQueueItem(candidate.id, {
        eventType: 'scheduled',
        note: `队列等待自动续跑: ${new Date(nextAutoResumeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        autoResumeEnabled: true,
        nextAutoResumeAt,
      }));
    }

    // Main process dispatches due scheduled items; renderer only persists schedule state here.
  }, [apiSettings.autoResumeGoals, apiSettings.autoResumeDelaySeconds, currentGoal, goalQueue]);

  useEffect(() => {
    activeGoalDispatchExecutorRef.current = async (goalId?: string, conversationId?: string) => {
      if (isStreamingRef.current) return;
      if (!apiSettings.autoResumeGoals) return;
      const snapshot = loadActiveGoalSnapshot();
      if (!snapshot?.goal) return;
      if (autoResumeTriggeredGoalIdRef.current === snapshot.goal.id) return;
      if (queueSchedulerTriggeredRef.current === snapshot.goal.id) return;
      if (goalId && snapshot.goal.id !== goalId) return;
      const goalConversationId = conversationId || snapshot.conversationId || currentGoalConversationId || activeConversationId;
      if (!goalConversationId) return;
      if (snapshot.goal.status === 'completed' || snapshot.goal.status === 'executing') return;

      autoResumeTriggeredGoalIdRef.current = snapshot.goal.id;
      const source = buildResumeSourceFromGoal(goalConversationId, snapshot.goal, snapshot.agents || [], snapshot.meta);
      pendingResumeSourceRef.current = { item: source, mode: 'auto' };
      clearActiveGoalSnapshot();
      setGoalQueue(transitionGoalQueueItem(source.id, {
        status: 'running',
        eventType: 'auto_resume',
        note: '当前目标自动续跑已启动',
        autoResumeEnabled: false,
      }));
      clearGoalState();
      void handleSend(buildResumeGoalPrompt(snapshot.goal), undefined, undefined, goalConversationId);
    };
  }, [activeConversationId, currentGoalConversationId, handleSend, apiSettings.autoResumeGoals]);

  useEffect(() => {
    if (!window.electronAPI?.onActiveGoalDispatch) return;

    return window.electronAPI.onActiveGoalDispatch((event) => {
      void activeGoalDispatchExecutorRef.current?.(event.goalId, event.conversationId);
    });
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onGoalRunStateUpdate) return;

    return window.electronAPI.onGoalRunStateUpdate(({ run }) => {
      if (!run?.conversationId) return;
      if (currentGoalConversationId && run.conversationId !== currentGoalConversationId) return;
      const progressMsgId = activeGoalProgressMsgIdRef.current;

      if (run.goalSnapshot) {
        setCurrentGoal(run.goalSnapshot as Goal);
      }
      if (run.agentsSnapshot) {
        setGoalAgents(run.agentsSnapshot as Agent[]);
      }
      setGoalRunMeta({
        savedAt: run.updatedAt || Date.now(),
        lastHeartbeatAt: run.lastHeartbeatAt || Date.now(),
        failureCount: run.events?.filter((event) => event.type === 'failed' || event.type === 'subtask_failed').length || 0,
        statusNote: run.statusNote,
      });

      if (!progressMsgId) return;
      const liveText =
        run.status === 'completed'
          ? `🎉 目标已完成：${run.goalSnapshot?.description || run.description || '目标'}`
          : run.status === 'failed'
            ? `❌ 目标执行失败：${run.goalSnapshot?.description || run.description || '目标'}`
            : run.statusNote || `⏳ 正在执行：${run.goalSnapshot?.description || run.description || '目标'}`;

      updateConversation(run.conversationId, (c) => ({
        messages: c.messages.map((m) =>
          m.id === progressMsgId ? { ...m, content: liveText } : m
        ),
        activeMessageId: progressMsgId || c.activeMessageId,
      }));

      if (run.status === 'completed' || run.status === 'failed') {
        activeGoalProgressMsgIdRef.current = null;
      }
    });
  }, [currentGoalConversationId, setConversations]);

  useEffect(() => {
    queueDispatchExecutorRef.current = async (goalId: string) => {
      if (
        currentGoal ||
        isStreamingRef.current ||
        queueSchedulerTriggeredRef.current === goalId ||
        autoResumeTriggeredGoalIdRef.current === goalId ||
        pendingResumeSourceRef.current?.item.id === goalId
      ) {
        return;
      }
      if (!apiSettings.autoResumeGoals) return;
      const fresh = loadGoalQueue().find((item) => item.id === goalId);
      if (!fresh?.goal || fresh.status === 'paused' || fresh.status === 'completed') return;

      const claimed = window.electronAPI?.claimGoalQueueItem
        ? await window.electronAPI.claimGoalQueueItem(fresh.id)
        : transitionGoalQueueItem(fresh.id, {
            status: 'running',
            eventType: 'auto_resume',
            note: '调度器已启动自动续跑',
            autoResumeEnabled: false,
          }).find((item) => item.id === fresh.id) || null;
      if (!claimed?.goal) {
        setGoalQueue(loadGoalQueue());
        return;
      }

      queueSchedulerTriggeredRef.current = goalId;
      pendingResumeSourceRef.current = { item: claimed, mode: 'auto' };
      startQueueHeartbeat(claimed.id);
      const nextQueue = loadGoalQueue().map((item) => item.id === claimed.id ? claimed : item).slice(0, 20);
      safeStorage.setItem(GOAL_QUEUE_STORAGE_KEY, JSON.stringify(nextQueue));
      persistAppState(GOAL_QUEUE_APP_STATE_KEY, nextQueue);
      setGoalQueue(nextQueue);
      void handleSend(buildResumeGoalPrompt(claimed.goal as Goal), undefined, undefined, claimed.conversationId);
    };
  }, [currentGoal, handleSend, startQueueHeartbeat, apiSettings.autoResumeGoals]);

  useEffect(() => {
    if (!window.electronAPI?.onGoalQueueDispatch) return;

    return window.electronAPI.onGoalQueueDispatch((event) => {
      void queueDispatchExecutorRef.current?.(event.goalId);
    });
  }, []);

  useEffect(() => {
    const recoverStaleQueueItems = () => {
      if (currentGoal || isStreamingRef.current) return;
      const recoveredQueue = recoverStaleRunningGoalQueue();
      if (!recoveredQueue.changed) return;

      if (recoveredQueue.recoveredIds.includes(queueSchedulerTriggeredRef.current || '')) {
        queueSchedulerTriggeredRef.current = null;
      }
      setGoalQueue(recoveredQueue.queue);
    };

    recoverStaleQueueItems();
    const interval = window.setInterval(recoverStaleQueueItems, Math.max(15_000, Math.floor(GOAL_RUNNING_LEASE_MS / 3)));
    return () => window.clearInterval(interval);
  }, [currentGoal]);

  const handleEditAndFork = useCallback(async (msgId: string, newContent: string) => {
    let convId = activeConversationId;
    if (!convId) return;

    let localConversations = [...conversationsRef.current];
    const conv = localConversations.find((c) => c.id === convId);
    if (!conv) return;

    const originalMsg = conv.messages.find((m) => m.id === msgId);
    if (!originalMsg) return;

    const newMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: newContent,
      timestamp: Date.now(),
      parentId: originalMsg.parentId,
    };

    localConversations = localConversations.map((c) => {
      if (c.id === convId) {
        return {
          ...c,
          messages: [...c.messages, newMsg],
          activeMessageId: newMsg.id,
          updatedAt: Date.now(),
        };
      }
      return c;
    });
    saveConversations(localConversations);

    await handleSend("", undefined, newMsg.id);
  }, [activeConversationId, saveConversations, handleSend]);

  const regenerateResponse = useCallback(async (msgId: string) => {
    let convId = activeConversationId;
    if (!convId) return;

    let localConversations = [...conversationsRef.current];
    const conv = localConversations.find((c) => c.id === convId);
    if (!conv) return;

    const originalMsg = conv.messages.find((m) => m.id === msgId);
    if (!originalMsg) return;

    if (originalMsg.parentId) {
      await handleSend("", undefined, originalMsg.parentId);
    }
  }, [activeConversationId, handleSend]);

  const handleOpenFolder = async () => {
    if (window.electronAPI) {
      const dir = await window.electronAPI.openDirectory();
      if (dir) {
        setRootPath(dir);
      }
    }
  };

  const handleFileOpen = useCallback(async (path: string) => {
    if (window.electronAPI) {
      setViewingFilePath(path);
      setViewingFileContent(null);
      const content = await window.electronAPI.readFile(path);
      setViewingFileContent(content);
    }
  }, []);

  return (
    <ThemeProvider>
      <div className="app-main-panel" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', background: 'var(--bg-base)' }}>
        <TitleBar
          onSettingsClick={() => setSettingsOpen(true)}
          agentName={apiSettings.agentName}
          modelName={apiSettings.model}
          gitBranch={gitContext.split('\n')[0]?.replace('Git branch: ', '') || ''}
          projectName={rootPath?.split(/[\\/]/).pop() || ''}
        />
        <Suspense fallback={null}>
          <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} onSave={(s) => setApiSettings(s)} rootPath={rootPath} />
        </Suspense>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <Sidebar conversations={conversations} activeConversationId={activeConversationId} onSelect={handleSelectConversation} onNew={handleNewConversation} onDelete={handleDeleteConversation} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} width={sidebarWidth} />
          {!sidebarCollapsed && (
            <ResizableDivider
              orientation="left-to-right"
              currentWidth={sidebarWidth}
              onResize={setSidebarWidth}
              minWidth={160}
              maxWidth={450}
            />
          )}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-base)' }}>
            <div className="chat-topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeConversation?.title || DEFAULT_CONVERSATION_TITLE}
                </div>
                {activeConversation && activeConversation.messages.length > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {activeConversation.messages.length} msgs
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {!fileTreeCollapsed && (
                  <button onClick={() => setFileTreeCollapsed(true)} style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', background: 'var(--bg-overlay)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
                  </button>
                )}
                {fileTreeCollapsed && (
                  <button onClick={() => setFileTreeCollapsed(false)} style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', background: 'var(--bg-overlay)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <PanelRight size={14} />
                  </button>
                )}
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <ChatArea
                  conversation={activeConversation}
                  getActiveBranchMessages={getActiveBranchMessages}
                  onSwitchBranch={handleSwitchBranch}
                  onEditAndFork={handleEditAndFork}
                  onRegenerate={regenerateResponse}
                  agentName={apiSettings.agentName}
                  agentAvatar={apiSettings.agentAvatar}
                  goal={visibleGoal}
                  goalAgents={visibleGoalAgents}
                  goalRunMeta={visibleGoalRunMeta}
                  goalQueue={goalQueue}
                  onResumeGoal={handleResumeGoal}
                  onPauseGoal={handleStop}
                  onDismissGoal={handleDismissGoal}
                  onOpenGoalConversation={handleOpenGoalConversation}
                  onResumeGoalQueueItem={handleResumeGoalQueueItem}
                  onPauseGoalQueueItem={handlePauseGoalQueueItem}
                  onRemoveGoalQueueItem={handleRemoveGoalQueueItem}
                   onQuickPrompt={(prompt) => {
                    if (prompt === '/review' || prompt.startsWith('帮我规划')) {
                      void handleSend(prompt);
                    } else {
                      setDraftPrompt({ id: Date.now(), text: prompt });
                      window.dispatchEvent(new Event('piano-focus-input'));
                    }
                  }}
                  contextTokens={activeConversation ? Math.floor(getActiveBranchMessages(activeConversation).reduce((sum, m) => sum + (m.content || '').length, 0) * TOKEN_ESTIMATION_MULTIPLIER) : 0}
                />

                {/* Real-time Execution Panel */}
                <Suspense fallback={null}>
                  <ExecutionPanel
                    isVisible={(isStreaming || !!currentGoal) && !executionPanelDismissed}
                    onClose={() => {
                      setExecutionPanelDismissed(true);
                    }}
                    toolCalls={activeConversation?.messages
                      .filter(m => m.toolCalls)
                      .flatMap(m => m.toolCalls || [])
                      .slice(-10) || []}
                    currentGoal={currentGoal ? {
                      description: currentGoal.description,
                      status: currentGoal.status,
                      subTasks: currentGoal.subTasks.map(t => ({
                        id: t.id,
                        description: t.description,
                        status: t.status,
                        currentTool: t.currentTool,
                      })),
                    } : null}
                  />
                </Suspense>

                <InputArea
                  onSend={handleSend}
                  isStreaming={isStreaming}
                  onStop={handleStop}
                  usageStats={usageStats}
                  rootPath={rootPath}
                  apiSettings={apiSettings}
                  draftPrompt={draftPrompt}
                  onUpdateSettings={(newSettings) => {
                    setApiSettings(newSettings);
                    safeStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
                  }}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              </div>

              {/* Resizable divider */}
              {!fileTreeCollapsed && (
                <ResizableDivider
                    orientation="right-to-left"
                    currentWidth={fileTreeWidth}
                    onResize={setFileTreeWidth}
                    minWidth={180}
                    maxWidth={600}
                  />
              )}

              <Suspense fallback={null}>
                <FileTreePanel rootPath={rootPath} onOpenFolder={handleOpenFolder} onFileOpen={handleFileOpen} collapsed={fileTreeCollapsed} onToggleCollapse={() => setFileTreeCollapsed(!fileTreeCollapsed)} width={fileTreeWidth} />
              </Suspense>

              {viewingFilePath && (
                <>
                  {/* Resizable divider for code viewer */}
                  <ResizableDivider
                      orientation="right-to-left"
                      currentWidth={fileViewerWidth}
                      onResize={setFileViewerWidth}
                      minWidth={280}
                      maxWidth={1000}
                      zIndex={20}
                    />
                  <Suspense fallback={null}>
                    <FileViewerPanel
                      filePath={viewingFilePath}
                      content={viewingFileContent}
                      onClose={() => setViewingFilePath(null)}
                      width={fileViewerWidth}
                    />
                  </Suspense>
                </>
              )}
            </div>
          </div>
        </div>

        <SafetyConfirmModal
          isOpen={!!safetyConfirm?.isOpen}
          matchedKeyword={safetyConfirm?.matchedKeyword || ''}
          cmd={safetyConfirm?.cmd || ''}
          onResolve={(approved) => safetyConfirm?.resolve(approved)}
        />
      </div>
    </ThemeProvider>
  );
};

export default App;
