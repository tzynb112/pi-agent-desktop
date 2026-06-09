const FNV64_OFFSET_BASIS = BigInt('0xcbf29ce484222325');
const FNV64_PRIME = BigInt('0x100000001b3');
const FNV64_MASK = BigInt('0xffffffffffffffff');

export const ACTIVE_WORKSPACE_APP_STATE_KEY = 'active-workspace-path';
export const ACTIVE_WORKSPACE_STORAGE_KEY = 'active-workspace-path';

function isWindowsPlatform(): boolean {
  const platform =
    (typeof process !== 'undefined' && (process as { platform?: string }).platform) ||
    (typeof globalThis !== 'undefined' && 'navigator' in globalThis
      ? ((globalThis as { navigator?: { platform?: string } }).navigator?.platform || '')
      : '') ||
    '';
  return platform.toLowerCase().includes('win');
}

export function normalizeWorkspacePath(workspacePath?: string | null): string | null {
  if (!workspacePath) return null;
  const trimmed = workspacePath.trim();
  if (!trimmed) return null;

  return trimmed.replace(/\\/g, '/').replace(/\/+$/, '') || null;
}

function hashWorkspacePath(workspacePath: string): string {
  const input = isWindowsPlatform() ? workspacePath.toLowerCase() : workspacePath;
  let hash = FNV64_OFFSET_BASIS;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

function sanitizeSegment(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

const WORKSPACE_SCOPED_KEY_RE = /\.ws\.[a-z0-9-]+\.[a-f0-9]{16}$/i;

export function getWorkspaceLabel(workspacePath?: string | null): string {
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!normalized) return 'global';

  const parts = normalized.split('/').filter(Boolean);
  const lastPart = parts[parts.length - 1] || 'workspace';
  const label = sanitizeSegment(lastPart);
  return label || 'workspace';
}

export function buildWorkspaceScopeId(workspacePath?: string | null): string {
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!normalized) return 'global';

  const label = getWorkspaceLabel(normalized);
  const hash = hashWorkspacePath(normalized);
  return `ws.${label}.${hash}`;
}

export function buildWorkspaceScopedKey(baseKey: string, workspacePath?: string | null): string {
  const safeBase = baseKey.trim().replace(/[^a-z0-9_.-]+/gi, '-');
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!normalized) return safeBase;
  return `${safeBase}.${buildWorkspaceScopeId(normalized)}`;
}

export function isWorkspaceScopedKey(key: string): boolean {
  return WORKSPACE_SCOPED_KEY_RE.test(key.trim());
}
