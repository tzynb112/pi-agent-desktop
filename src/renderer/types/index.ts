export type {
  ActiveGoalDispatchEvent,
  ApiProxyRequest,
  ApiProxyResponse,
  ApiProxyStreamEvent,
  ApiProxyStreamRequest,
  ElectronAPI,
  FileDialogOptions,
  FileEntry,
  GoalQueueDispatchCandidate,
  GoalQueueDispatchEvent,
  GoalQueueEvent,
  GoalQueueItem,
  GoalRunControl,
  GoalRunControlAction,
  GoalRunEvent,
  GoalRunEventPatch,
  GoalRunMeta,
  GoalRunStartPayload,
  GoalRunState,
  GoalRunStatePatch,
  McpServerConfig,
  McpTool,
  ToolExecutionResult,
  UsageStats,
} from '../../shared/ipc-types';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  liveOutput?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
  parentId?: string;
  reasoningContent?: string;
  hidden?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  model?: string;
  activeMessageId?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  prompt: string;
  iconName?: string;
}

export type ThemeType = 'dark' | 'light';

declare global {
  interface Window {
    electronAPI?: import('../../shared/ipc-types').ElectronAPI;
  }
}
