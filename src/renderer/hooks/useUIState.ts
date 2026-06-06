import { useState, useRef, useCallback, useEffect } from 'react';

export interface UIState {
  activeConversationId: string | null;
  sidebarCollapsed: boolean;
  fileTreeCollapsed: boolean;
  viewingFilePath: string | null;
}

import { safeStorage } from '../utils/storage';

const UI_STATE_STORAGE_KEY = 'piano-ui-state';

function loadUIState(): UIState {
  try {
    const saved = safeStorage.getItem(UI_STATE_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('[useUIState] Failed to load:', e);
  }
  return { activeConversationId: null, sidebarCollapsed: false, fileTreeCollapsed: false, viewingFilePath: null };
}

export function useUIState() {
  const initialUIState = useRef(loadUIState()).current;

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

  // Restore file viewer content on mount
  useEffect(() => {
    if (initialUIState.viewingFilePath && window.electronAPI) {
      window.electronAPI.readFile(initialUIState.viewingFilePath).then(content => {
        setViewingFileContent(content);
      }).catch(err => {
        console.warn('[useUIState] Failed to restore viewing file:', err);
        setViewingFilePath(null);
      });
    }
  }, [initialUIState.viewingFilePath]);

  const toggleSidebar = useCallback(() => setSidebarCollapsed(prev => !prev), []);
  const toggleFileTree = useCallback(() => setFileTreeCollapsed(prev => !prev), []);

  return {
    // State
    sidebarCollapsed, setSidebarCollapsed,
    fileTreeCollapsed, setFileTreeCollapsed,
    fileTreeWidth, setFileTreeWidth,
    sidebarWidth, setSidebarWidth,
    fileViewerWidth, setFileViewerWidth,
    viewingFilePath, setViewingFilePath,
    viewingFileContent, setViewingFileContent,
    settingsOpen, setSettingsOpen,
    initialUIState,
    // Refs
    isResizingRef,
    isSidebarResizingRef,
    isFileViewerResizingRef,
    // Actions
    toggleSidebar,
    toggleFileTree,
  };
}
