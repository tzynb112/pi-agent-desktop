import { contextBridge, ipcRenderer } from 'electron';
import type {
  ActiveGoalDispatchEvent,
  ApiProxyStreamEvent,
  ElectronAPI,
  GoalRunStateUpdateEvent,
  GoalQueueDispatchEvent,
} from '../shared/ipc-types';

const electronAPI: ElectronAPI = {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  openDirectory: () => ipcRenderer.invoke('dialog-open-directory'),
  saveFile: (options) => ipcRenderer.invoke('dialog-save-file', options),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  readAppState: (key: string) => ipcRenderer.invoke('app-state-read', key),
  writeAppState: (key: string, value: unknown) => ipcRenderer.invoke('app-state-write', key, value),
  removeAppState: (key: string) => ipcRenderer.invoke('app-state-remove', key),
  claimGoalQueueItem: (goalId: string) => ipcRenderer.invoke('goal-queue-claim', goalId),
  heartbeatGoalQueueItem: (goalId: string) => ipcRenderer.invoke('goal-queue-heartbeat', goalId),
  completeGoalQueueItem: (goalId: string, targetGoalId?: string) => ipcRenderer.invoke('goal-queue-complete', goalId, targetGoalId),
  failGoalQueueItem: (goalId: string, note?: string) => ipcRenderer.invoke('goal-queue-fail', goalId, note),
  startGoalRun: (payload) => ipcRenderer.invoke('goal-run-start', payload),
  executeGoalRun: (payload) => ipcRenderer.invoke('goal-run-execute', payload),
  readLatestRunningGoalRun: () => ipcRenderer.invoke('goal-run-latest-running'),
  heartbeatGoalRun: (runId: string, patch) => ipcRenderer.invoke('goal-run-heartbeat', runId, patch),
  appendGoalRunEvent: (runId: string, event) => ipcRenderer.invoke('goal-run-event', runId, event),
  completeGoalRun: (runId: string) => ipcRenderer.invoke('goal-run-complete', runId),
  failGoalRun: (runId: string, error?: string) => ipcRenderer.invoke('goal-run-fail', runId, error),
  requestGoalRunControl: (runId: string, action: 'pause' | 'cancel' | 'stop', reason?: string) => ipcRenderer.invoke('goal-run-control-request', runId, action, reason),
  readGoalRunControl: (runId: string) => ipcRenderer.invoke('goal-run-control-read', runId),
  acknowledgeGoalRunControl: (runId: string) => ipcRenderer.invoke('goal-run-control-ack', runId),
  onGoalQueueDispatch: (callback) => {
    const listener = (_event: any, data: GoalQueueDispatchEvent) => callback(data);
    ipcRenderer.on('goal-queue-dispatch', listener);
    return () => {
      ipcRenderer.removeListener('goal-queue-dispatch', listener);
    };
  },
  onActiveGoalDispatch: (callback) => {
    const listener = (_event: any, data: ActiveGoalDispatchEvent) => callback(data);
    ipcRenderer.on('active-goal-dispatch', listener);
    return () => {
      ipcRenderer.removeListener('active-goal-dispatch', listener);
    };
  },
  onGoalRunStateUpdate: (callback) => {
    const listener = (_event: any, data: GoalRunStateUpdateEvent) => callback(data);
    ipcRenderer.on('goal-run-state-update', listener);
    return () => {
      ipcRenderer.removeListener('goal-run-state-update', listener);
    };
  },
  cancelActiveTools: () => ipcRenderer.invoke('tools-cancel-active'),
  executeTool: (toolName: string, args: string, toolCallId?: string) => ipcRenderer.invoke('execute-tool', toolName, args, toolCallId),
  apiProxy: (data) => ipcRenderer.invoke('api-proxy', data),
  apiProxyStream: (data) => ipcRenderer.invoke('api-proxy-stream', data),
  onApiProxyStreamEvent: (callback) => {
    const listener = (_event: any, data: ApiProxyStreamEvent) => callback(data);
    ipcRenderer.on('api-proxy-stream-event', listener);
    return () => {
      ipcRenderer.removeListener('api-proxy-stream-event', listener);
    };
  },
  loadMcpTools: (servers) => ipcRenderer.invoke('load-mcp-tools', servers),
  executeMcpTool: (serverId: string, toolName: string, args: string) => ipcRenderer.invoke('execute-mcp-tool', serverId, toolName, args),
  onToolLiveOutput: (callback) => {
    const listener = (_event: any, data: { toolCallId: string; text: string }) => callback(data);
    ipcRenderer.on('tool-live-output', listener);
    return () => {
      ipcRenderer.removeListener('tool-live-output', listener);
    };
  },
  onSettingsChanged: (callback) => {
    const listener = (_event: any, data: { key: string; value: any }) => callback(data);
    ipcRenderer.on('settings-changed', listener);
    return () => {
      ipcRenderer.removeListener('settings-changed', listener);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
