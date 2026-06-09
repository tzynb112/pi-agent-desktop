import type { ElectronAPI } from '../../shared/ipc-types';

export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined;
};

export const getElectronAPI = (): ElectronAPI | null => {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI;
  }
  return null;
};

/**
 * electronSafe - 安全的 Electron API 封装包装器
 * 在非 Electron 环境（如常规浏览器 preview 模式）下自动降级为日志警告或默认返回值，防止抛出未定义错误。
 */
export const electronSafe = {
  minimizeWindow: (): void => {
    window.electronAPI?.minimizeWindow?.();
  },

  maximizeWindow: (): void => {
    window.electronAPI?.maximizeWindow?.();
  },

  closeWindow: (): void => {
    window.electronAPI?.closeWindow?.();
  },

  openDirectory: async (): Promise<string | null> => {
    if (window.electronAPI?.openDirectory) {
      return window.electronAPI.openDirectory();
    }
    console.warn('[electronSafe] openDirectory: Electron API is not available');
    return null;
  },

  saveFile: async (options: any): Promise<string | null> => {
    if (window.electronAPI?.saveFile) {
      return window.electronAPI.saveFile(options);
    }
    console.warn('[electronSafe] saveFile: Electron API is not available');
    return null;
  },

  readDirectory: async (dirPath: string): Promise<any[]> => {
    if (window.electronAPI?.readDirectory) {
      return window.electronAPI.readDirectory(dirPath);
    }
    console.warn('[electronSafe] readDirectory: Electron API is not available');
    return [];
  },

  readFile: async (filePath: string): Promise<string> => {
    if (window.electronAPI?.readFile) {
      const res = await window.electronAPI.readFile(filePath);
      return res ?? '';
    }
    console.warn('[electronSafe] readFile: Electron API is not available');
    return '';
  },

  writeFile: async (filePath: string, content: string): Promise<boolean> => {
    if (window.electronAPI?.writeFile) {
      return window.electronAPI.writeFile(filePath, content);
    }
    console.warn('[electronSafe] writeFile: Electron API is not available');
    return false;
  },

  readAppState: async <T>(key: string): Promise<T | null> => {
    if (window.electronAPI?.readAppState) {
      return window.electronAPI.readAppState<T>(key);
    }
    return null;
  },

  writeAppState: async (key: string, value: unknown): Promise<boolean> => {
    if (window.electronAPI?.writeAppState) {
      return window.electronAPI.writeAppState(key, value);
    }
    return false;
  },

  removeAppState: async (key: string): Promise<boolean> => {
    if (window.electronAPI?.removeAppState) {
      return window.electronAPI.removeAppState(key);
    }
    return false;
  },

  claimGoalQueueItem: async (goalId: string): Promise<any | null> => {
    if (window.electronAPI?.claimGoalQueueItem) {
      return window.electronAPI.claimGoalQueueItem(goalId);
    }
    return null;
  },

  heartbeatGoalQueueItem: async (goalId: string): Promise<any | null> => {
    if (window.electronAPI?.heartbeatGoalQueueItem) {
      return window.electronAPI.heartbeatGoalQueueItem(goalId);
    }
    return null;
  },

  completeGoalQueueItem: async (goalId: string, targetGoalId?: string): Promise<any | null> => {
    if (window.electronAPI?.completeGoalQueueItem) {
      return window.electronAPI.completeGoalQueueItem(goalId, targetGoalId);
    }
    return null;
  },

  failGoalQueueItem: async (goalId: string, note?: string): Promise<any | null> => {
    if (window.electronAPI?.failGoalQueueItem) {
      return window.electronAPI.failGoalQueueItem(goalId, note);
    }
    return null;
  },

  startGoalRun: async (payload: any): Promise<any | null> => {
    if (window.electronAPI?.startGoalRun) {
      return window.electronAPI.startGoalRun(payload);
    }
    return null;
  },

  executeGoalRun: async (payload: any): Promise<any> => {
    if (window.electronAPI?.executeGoalRun) {
      return window.electronAPI.executeGoalRun(payload);
    }
    return { success: false, error: 'Electron API is not available' };
  },

  readLatestRunningGoalRun: async (workspacePath?: string | null): Promise<any | null> => {
    if (window.electronAPI?.readLatestRunningGoalRun) {
      return window.electronAPI.readLatestRunningGoalRun(workspacePath);
    }
    return null;
  },

  heartbeatGoalRun: async (runId: string, patch: any): Promise<any | null> => {
    if (window.electronAPI?.heartbeatGoalRun) {
      return window.electronAPI.heartbeatGoalRun(runId, patch);
    }
    return null;
  },

  appendGoalRunEvent: async (runId: string, event: any): Promise<any | null> => {
    if (window.electronAPI?.appendGoalRunEvent) {
      return window.electronAPI.appendGoalRunEvent(runId, event);
    }
    return null;
  },

  completeGoalRun: async (runId: string): Promise<any | null> => {
    if (window.electronAPI?.completeGoalRun) {
      return window.electronAPI.completeGoalRun(runId);
    }
    return null;
  },

  failGoalRun: async (runId: string, error?: string): Promise<any | null> => {
    if (window.electronAPI?.failGoalRun) {
      return window.electronAPI.failGoalRun(runId, error);
    }
    return null;
  },

  requestGoalRunControl: async (runId: string, action: 'pause' | 'cancel' | 'stop', reason?: string): Promise<any | null> => {
    if (window.electronAPI?.requestGoalRunControl) {
      return window.electronAPI.requestGoalRunControl(runId, action, reason);
    }
    return null;
  },

  readGoalRunControl: async (runId: string): Promise<any | null> => {
    if (window.electronAPI?.readGoalRunControl) {
      return window.electronAPI.readGoalRunControl(runId);
    }
    return null;
  },

  acknowledgeGoalRunControl: async (runId: string): Promise<any | null> => {
    if (window.electronAPI?.acknowledgeGoalRunControl) {
      return window.electronAPI.acknowledgeGoalRunControl(runId);
    }
    return null;
  },

  onGoalQueueDispatch: (callback: (data: any) => void): (() => void) => {
    if (window.electronAPI?.onGoalQueueDispatch) {
      return window.electronAPI.onGoalQueueDispatch(callback);
    }
    return () => {};
  },

  onActiveGoalDispatch: (callback: (data: any) => void): (() => void) => {
    if (window.electronAPI?.onActiveGoalDispatch) {
      return window.electronAPI.onActiveGoalDispatch(callback);
    }
    return () => {};
  },

  onGoalRunStateUpdate: (callback: (data: any) => void): (() => void) => {
    if (window.electronAPI?.onGoalRunStateUpdate) {
      return window.electronAPI.onGoalRunStateUpdate(callback);
    }
    return () => {};
  },

  cancelActiveTools: async (): Promise<any> => {
    if (window.electronAPI?.cancelActiveTools) {
      return window.electronAPI.cancelActiveTools();
    }
  },

  executeTool: async (toolName: string, args: string, toolCallId?: string): Promise<any> => {
    if (window.electronAPI?.executeTool) {
      return window.electronAPI.executeTool(toolName, args, toolCallId);
    }
    return { stdout: '', stderr: 'Electron API is not available', exitCode: -1 };
  },

  apiProxy: async (data: any): Promise<any> => {
    if (window.electronAPI?.apiProxy) {
      return window.electronAPI.apiProxy(data);
    }
    return { success: false, error: 'Electron API is not available' };
  },

  apiProxyStream: async (data: any): Promise<any> => {
    if (window.electronAPI?.apiProxyStream) {
      return window.electronAPI.apiProxyStream(data);
    }
    return { success: false, error: 'Electron API is not available' };
  },

  onApiProxyStreamEvent: (callback: (data: any) => void): (() => void) => {
    if (window.electronAPI?.onApiProxyStreamEvent) {
      return window.electronAPI.onApiProxyStreamEvent(callback);
    }
    return () => {};
  },

  loadMcpTools: async (servers: any[]): Promise<any[]> => {
    if (window.electronAPI?.loadMcpTools) {
      return window.electronAPI.loadMcpTools(servers);
    }
    return [];
  },

  executeMcpTool: async (serverId: string, toolName: string, args: string): Promise<any> => {
    if (window.electronAPI?.executeMcpTool) {
      return window.electronAPI.executeMcpTool(serverId, toolName, args);
    }
    return { stdout: '', stderr: 'Electron API is not available', exitCode: -1 };
  },

  onToolLiveOutput: (callback: (data: { toolCallId: string; text: string }) => void): (() => void) => {
    if (window.electronAPI?.onToolLiveOutput) {
      return window.electronAPI.onToolLiveOutput(callback);
    }
    return () => {};
  },

  onSettingsChanged: (callback: (data: { key: string; value: any }) => void): (() => void) => {
    if (window.electronAPI?.onSettingsChanged) {
      return window.electronAPI.onSettingsChanged(callback);
    }
    return () => {};
  },
};
