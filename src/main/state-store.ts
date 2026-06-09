import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  ACTIVE_WORKSPACE_APP_STATE_KEY,
  buildWorkspaceScopedKey,
  isWorkspaceScopedKey,
  normalizeWorkspacePath,
} from '../shared/workspace-scope';

const APP_STATE_DIR = 'piano-state';
const APP_STATE_KEY_RE = /^[a-z0-9_.-]+$/i;

function getGlobalAppStatePath(key: string): string {
  if (!APP_STATE_KEY_RE.test(key)) {
    throw new Error(`Invalid app state key: ${key}`);
  }

  return path.join(app.getPath('userData'), APP_STATE_DIR, `${key}.json`);
}

export function readCurrentWorkspacePath(): string | null {
  const filePath = getGlobalAppStatePath(ACTIVE_WORKSPACE_APP_STATE_KEY);
  if (!fs.existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return typeof parsed === 'string' ? normalizeWorkspacePath(parsed) : null;
  } catch {
    return null;
  }
}

export function getAppStatePath(key: string, workspacePath?: string | null): string {
  if (key === ACTIVE_WORKSPACE_APP_STATE_KEY || isWorkspaceScopedKey(key)) {
    return getGlobalAppStatePath(key);
  }

  const resolvedWorkspacePath = workspacePath ?? readCurrentWorkspacePath();
  const scopedKey = buildWorkspaceScopedKey(key, resolvedWorkspacePath);
  return path.join(app.getPath('userData'), APP_STATE_DIR, `${scopedKey}.json`);
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

export function readJsonState<T>(key: string, workspacePath?: string | null): T | null {
  const filePath = getAppStatePath(key, workspacePath);
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (err: any) {
    try {
      fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch {
      // Best-effort quarantine only.
    }
    console.error(`[AppState] Failed to read state "${key}":`, err.message);
    return null;
  }
}

export function writeJsonState(key: string, value: unknown, workspacePath?: string | null): void {
  writeJsonFileAtomic(getAppStatePath(key, workspacePath), value);
}
