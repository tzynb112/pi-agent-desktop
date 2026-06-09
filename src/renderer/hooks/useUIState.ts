import { useState, useRef, useCallback, useEffect } from 'react';
import { safeStorage } from '../utils/storage';
import { getWorkspacePath, getWorkspaceStorageKey } from '../utils/workspace-context';

export interface UIState {
  activeConversationId: string | null;
  sidebarCollapsed: boolean;
  fileTreeCollapsed: boolean;
  viewingFilePath: string | null;
}

function resolveWorkspacePath(workspacePath?: string | null): string | null {
  return workspacePath ?? getWorkspacePath();
}

function getLayoutStateStorageKey(workspacePath?: string | null): string {
  return getWorkspaceStorageKey('piano-layout-state', resolveWorkspacePath(workspacePath));
}

function loadLayoutState(storageKey: string): UIState {
  try {
    const saved = safeStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<UIState>;
      return {
        activeConversationId: parsed.activeConversationId || null,
        sidebarCollapsed: !!parsed.sidebarCollapsed,
        fileTreeCollapsed: !!parsed.fileTreeCollapsed,
        viewingFilePath: parsed.viewingFilePath || null,
      };
    }
  } catch (e) {
    console.error('[useUIState] Failed to load:', e);
  }
  return { activeConversationId: null, sidebarCollapsed: false, fileTreeCollapsed: false, viewingFilePath: null };
}

export function useUIState(workspacePath?: string | null) {
  const resolvedWorkspacePath = resolveWorkspacePath(workspacePath);
  const storageKey = getLayoutStateStorageKey(resolvedWorkspacePath);
  const initialUIState = useRef(loadLayoutState(storageKey)).current;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialUIState.sidebarCollapsed);
  const [fileTreeCollapsed, setFileTreeCollapsed] = useState(initialUIState.fileTreeCollapsed);
  const [fileTreeWidth, setFileTreeWidth] = useState(260);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [fileViewerWidth, setFileViewerWidth] = useState(480);
  const [viewingFilePath, setViewingFilePath] = useState<string | null>(initialUIState.viewingFilePath);
  const [viewingFileContent, setViewingFileContent] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isResizingRef = useRef(false);
  const isSidebarResizingRef = useRef(false);
  const isFileViewerResizingRef = useRef(false);

  useEffect(() => {
    const next = loadLayoutState(storageKey);
    setSidebarCollapsed(next.sidebarCollapsed);
    setFileTreeCollapsed(next.fileTreeCollapsed);
    setViewingFilePath(next.viewingFilePath);
    setViewingFileContent(null);

    if (next.viewingFilePath && window.electronAPI) {
      window.electronAPI.readFile(next.viewingFilePath).then((content) => {
        setViewingFileContent(content);
      }).catch((err) => {
        console.warn('[useUIState] Failed to restore viewing file:', err);
        setViewingFilePath(null);
      });
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      const existing = loadLayoutState(storageKey);
      const next = {
        ...existing,
        sidebarCollapsed,
        fileTreeCollapsed,
        viewingFilePath,
      };
      safeStorage.setItem(storageKey, JSON.stringify(next));
    } catch (e) {
      console.error('[useUIState] Failed to persist layout state:', e);
    }
  }, [storageKey, sidebarCollapsed, fileTreeCollapsed, viewingFilePath]);

  const toggleSidebar = useCallback(() => setSidebarCollapsed((prev) => !prev), []);
  const toggleFileTree = useCallback(() => setFileTreeCollapsed((prev) => !prev), []);

  return {
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
    toggleSidebar,
    toggleFileTree,
  };
}
