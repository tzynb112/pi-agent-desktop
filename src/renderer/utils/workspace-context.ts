import {
  ACTIVE_WORKSPACE_APP_STATE_KEY,
  ACTIVE_WORKSPACE_STORAGE_KEY,
  buildWorkspaceScopeId,
  buildWorkspaceScopedKey,
  normalizeWorkspacePath,
} from '../../shared/workspace-scope';
import { safeStorage } from './storage';

let activeWorkspacePath: string | null = normalizeWorkspacePath(
  safeStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)
);

export function getWorkspacePath(): string | null {
  return activeWorkspacePath;
}

export function setWorkspacePath(workspacePath: string | null | undefined): void {
  const normalized = normalizeWorkspacePath(workspacePath);
  activeWorkspacePath = normalized;

  if (normalized) {
    safeStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, normalized);
    void window.electronAPI?.writeAppState?.(ACTIVE_WORKSPACE_APP_STATE_KEY, normalized).catch((err) => {
      console.warn('[workspace-context] Failed to persist active workspace path:', err);
    });
  } else {
    safeStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    void window.electronAPI?.removeAppState?.(ACTIVE_WORKSPACE_APP_STATE_KEY).catch((err) => {
      console.warn('[workspace-context] Failed to clear active workspace path:', err);
    });
  }
}

export function getWorkspaceScopeId(workspacePath: string | null | undefined = activeWorkspacePath): string {
  return buildWorkspaceScopeId(workspacePath);
}

export function getWorkspaceStorageKey(baseKey: string, workspacePath: string | null | undefined = activeWorkspacePath): string {
  return buildWorkspaceScopedKey(baseKey, workspacePath);
}
