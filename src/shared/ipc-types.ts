export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
  expanded?: boolean;
}

export interface FileDialogOptions {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
}

export interface ApiProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ApiProxyResponse {
  status: number;
  body: string;
}

export interface ApiProxyStreamRequest extends ApiProxyRequest {
  streamId: string;
}

export interface ApiProxyStreamEvent {
  streamId: string;
  type: 'start' | 'chunk' | 'end' | 'error';
  status?: number;
  body?: string;
  text?: string;
}

export interface GoalRunStartPayload {
  id?: string;
  conversationId?: string;
  goalId?: string;
  description?: string;
  workspacePath?: string;
  statusNote?: string;
  startedAt?: number;
  goalSnapshot?: any;
  agentsSnapshot?: any[];
}

export interface GoalRunMeta {
  savedAt: number;
  lastHeartbeatAt: number;
  failureCount: number;
  nextAutoResumeAt?: number;
  lastDispatchAt?: number;
  autoResumeEnabled?: boolean;
  statusNote?: string;
}

export interface GoalRunExecutePayload extends GoalRunStartPayload {
  apiSettings: {
    baseURL: string;
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    sandboxType?: 'none' | 'docker' | 'guard';
    dangerousKeywords?: string;
    trustMode?: boolean;
  };
  existingGoal?: any;
  maxConcurrentAgents?: number;
}

export interface GoalRunExecuteResult {
  run: GoalRunState | null;
  goal: any;
  agents: any[];
}

export interface GoalRunEvent {
  id: string;
  at: number;
  type: string;
  message?: string;
  goalId?: string;
}

export interface GoalRunState {
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
  events?: GoalRunEvent[];
  control?: GoalRunControl;
  error?: string;
}

export interface GoalRunStatePatch {
  goalId?: string;
  description?: string;
  statusNote?: string;
  goalSnapshot?: any;
  agentsSnapshot?: any[];
}

export interface GoalRunStateUpdateEvent {
  run: GoalRunState;
}

export type GoalRunHeartbeatPatch = GoalRunStatePatch;

export interface GoalRunEventPatch extends GoalRunStatePatch {
  type: string;
  message?: string;
}

export type GoalRunControlAction = 'pause' | 'cancel' | 'stop';

export interface GoalRunControl {
  action: GoalRunControlAction;
  reason?: string;
  requestedAt: number;
  acknowledgedAt?: number;
}

export interface GoalQueueEvent {
  id: string;
  at: number;
  type:
    | 'created'
    | 'updated'
    | 'heartbeat'
    | 'manual_continue'
    | 'paused'
    | 'removed'
    | 'scheduled'
    | 'auto_resume'
    | 'recovered'
    | 'failed'
    | 'completed';
  message: string;
}

export interface GoalQueueItem {
  id: string;
  conversationId: string;
  parentGoalId?: string;
  resumeChain?: string[];
  title: string;
  description: string;
  status: 'queued' | 'running' | 'paused' | 'failed' | 'completed';
  createdAt: number;
  updatedAt: number;
  goal?: any;
  agents?: any[];
  meta?: GoalRunMeta;
  history?: GoalQueueEvent[];
}

export interface GoalQueueDispatchCandidate {
  goalId: string;
  conversationId?: string;
}

export interface GoalQueueDispatchEvent extends GoalQueueDispatchCandidate {
  reason: string;
  at: number;
}

export interface ActiveGoalDispatchEvent {
  goalId?: string;
  conversationId?: string;
  reason: string;
  at: number;
}

export interface UsageStats {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  responseTime: number;
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string | string[];
  env?: string | Record<string, string>;
  enabled: boolean;
}

export type McpTool = Record<string, unknown> & {
  name: string;
  description?: string;
  mcpServerId?: string;
  mcpServerName?: string;
};

export interface ElectronAPI {
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  openDirectory: () => Promise<string | null>;
  saveFile: (options: FileDialogOptions) => Promise<string | null>;
  readDirectory: (dirPath: string) => Promise<FileEntry[]>;
  readFile: (filePath: string) => Promise<string | null>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  readAppState?: <T = unknown>(key: string) => Promise<T | null>;
  writeAppState?: (key: string, value: unknown) => Promise<boolean>;
  removeAppState?: (key: string) => Promise<boolean>;
  claimGoalQueueItem?: (goalId: string) => Promise<GoalQueueItem | null>;
  heartbeatGoalQueueItem?: (goalId: string) => Promise<GoalQueueItem | null>;
  completeGoalQueueItem?: (goalId: string, targetGoalId?: string) => Promise<GoalQueueItem | null>;
  failGoalQueueItem?: (goalId: string, note?: string) => Promise<GoalQueueItem | null>;
  startGoalRun?: (payload: GoalRunStartPayload) => Promise<GoalRunState | null>;
  executeGoalRun?: (payload: GoalRunExecutePayload) => Promise<GoalRunExecuteResult | null>;
  readLatestRunningGoalRun?: (workspacePath?: string | null) => Promise<GoalRunState | null>;
  heartbeatGoalRun?: (runId: string, patch?: GoalRunStatePatch) => Promise<GoalRunState | null>;
  appendGoalRunEvent?: (runId: string, event: GoalRunEventPatch) => Promise<GoalRunState | null>;
  completeGoalRun?: (runId: string) => Promise<GoalRunState | null>;
  failGoalRun?: (runId: string, error?: string) => Promise<GoalRunState | null>;
  requestGoalRunControl?: (runId: string, action: GoalRunControlAction, reason?: string) => Promise<GoalRunState | null>;
  readGoalRunControl?: (runId: string) => Promise<GoalRunControl | null>;
  acknowledgeGoalRunControl?: (runId: string) => Promise<GoalRunState | null>;
  onGoalQueueDispatch?: (callback: (data: GoalQueueDispatchEvent) => void) => () => void;
  onActiveGoalDispatch?: (callback: (data: ActiveGoalDispatchEvent) => void) => () => void;
  onGoalRunStateUpdate?: (callback: (data: GoalRunStateUpdateEvent) => void) => () => void;
  cancelActiveTools?: () => Promise<number>;
  executeTool: (toolName: string, args: string, toolCallId?: string) => Promise<ToolExecutionResult>;
  apiProxy: (data: ApiProxyRequest) => Promise<ApiProxyResponse>;
  apiProxyStream: (data: ApiProxyStreamRequest) => Promise<ApiProxyResponse>;
  onApiProxyStreamEvent?: (callback: (data: ApiProxyStreamEvent) => void) => () => void;
  loadMcpTools: (servers: McpServerConfig[]) => Promise<McpTool[]>;
  executeMcpTool: (serverId: string, toolName: string, args: string) => Promise<ToolExecutionResult>;
  onToolLiveOutput?: (callback: (data: { toolCallId: string; text: string }) => void) => () => void;
  onSettingsChanged?: (callback: (data: { key: string; value: unknown }) => void) => () => void;
}
