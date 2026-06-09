import { useState, useRef, useCallback, useEffect } from 'react';
import { Conversation, ChatMessage } from '../types';
import { sanitizeConversations } from '../utils/message-sanitize';
import { safeStorage } from '../utils/storage';
import { getWorkspacePath, getWorkspaceStorageKey } from '../utils/workspace-context';

function resolveWorkspacePath(workspacePath?: string | null): string | null {
  return workspacePath ?? getWorkspacePath();
}

function getConversationsStorageKey(workspacePath?: string | null): string {
  return getWorkspaceStorageKey('piano-conversations', resolveWorkspacePath(workspacePath));
}

function getUiStateStorageKey(workspacePath?: string | null): string {
  return getWorkspaceStorageKey('piano-ui-state', resolveWorkspacePath(workspacePath));
}

function loadConversations(storageKey: string): Conversation[] {
  const saved = safeStorage.getItem(storageKey);
  if (!saved) return [];
  try {
    return sanitizeConversations(JSON.parse(saved));
  } catch {
    return [];
  }
}

function loadActiveConversationId(storageKey: string): string | null {
  try {
    const saved = safeStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved).activeConversationId || null;
  } catch {
    // Ignore corrupt state and fall back to null.
  }
  return null;
}

function persistActiveConversationId(storageKey: string, activeConversationId: string | null): void {
  try {
    const saved = safeStorage.getItem(storageKey);
    const existing = saved ? JSON.parse(saved) : {};
    if (existing.activeConversationId !== activeConversationId) {
      existing.activeConversationId = activeConversationId;
      safeStorage.setItem(storageKey, JSON.stringify(existing));
    }
  } catch (e) {
    console.error('Failed to save activeConversationId to piano-ui-state:', e);
  }
}

export function useConversations(workspacePath?: string | null) {
  const resolvedWorkspacePath = resolveWorkspacePath(workspacePath);
  const conversationsStorageKey = getConversationsStorageKey(resolvedWorkspacePath);
  const uiStateStorageKey = getUiStateStorageKey(resolvedWorkspacePath);

  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations(conversationsStorageKey));
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => loadActiveConversationId(uiStateStorageKey));

  const conversationsRef = useRef<Conversation[]>(conversations);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    const nextConversations = loadConversations(conversationsStorageKey);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);

    const storedActiveConversationId = loadActiveConversationId(uiStateStorageKey);
    const fallbackActiveConversationId = nextConversations.length > 0 ? nextConversations[0].id : null;
    const nextActiveConversationId = storedActiveConversationId && nextConversations.some((c) => c.id === storedActiveConversationId)
      ? storedActiveConversationId
      : fallbackActiveConversationId;

    setActiveConversationId(nextActiveConversationId);
    persistActiveConversationId(uiStateStorageKey, nextActiveConversationId);
  }, [conversationsStorageKey, uiStateStorageKey]);

  useEffect(() => {
    if (!activeConversationId) return;
    const exists = conversations.some((c) => c.id === activeConversationId);
    if (!exists) {
      const nextActiveConversationId = conversations.length > 0 ? conversations[0].id : null;
      setActiveConversationId(nextActiveConversationId);
      persistActiveConversationId(uiStateStorageKey, nextActiveConversationId);
    }
  }, [conversations, activeConversationId, uiStateStorageKey]);

  useEffect(() => {
    persistActiveConversationId(uiStateStorageKey, activeConversationId);
  }, [activeConversationId, uiStateStorageKey]);

  const saveConversations = useCallback((convs: Conversation[]) => {
    const sanitized = sanitizeConversations(convs);
    conversationsRef.current = sanitized;
    setConversations(sanitized);
    try {
      safeStorage.setItem(conversationsStorageKey, JSON.stringify(sanitized));
    } catch (e) {
      console.error('Failed to save conversations:', e);
    }
  }, [conversationsStorageKey]);

  const getActiveBranchMessages = useCallback((conv: Conversation | null): ChatMessage[] => {
    if (!conv) return [];
    if (!conv.activeMessageId || conv.messages.length === 0) return conv.messages;
    const messagesMap = new Map<string, ChatMessage>();
    for (const m of conv.messages) messagesMap.set(m.id, m);
    const chain: ChatMessage[] = [];
    let currentId: string | undefined = conv.activeMessageId;
    const visited = new Set<string>();
    while (currentId && messagesMap.has(currentId)) {
      if (visited.has(currentId)) {
        console.warn('[useConversations] Infinite loop detected:', currentId);
        break;
      }
      visited.add(currentId);
      const msg: ChatMessage = messagesMap.get(currentId)!;
      chain.push(msg);
      currentId = msg.parentId;
    }
    return chain.reverse();
  }, []);

  const updateConversation = useCallback((id: string, updater: (c: Conversation) => Partial<Conversation>) => {
    setConversations((prev) => {
      const updated = prev.map((c) => {
        if (c.id !== id) return c;
        const res = updater(c);
        return { ...c, ...res, updatedAt: Date.now() };
      });
      const sanitized = sanitizeConversations(updated);
      conversationsRef.current = sanitized;
      try {
        safeStorage.setItem(conversationsStorageKey, JSON.stringify(sanitized));
      } catch (e) {
        console.error('Failed to save conversations:', e);
      }
      return sanitized;
    });
  }, [conversationsStorageKey]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;

  return {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    activeConversation,
    conversationsRef,
    saveConversations,
    getActiveBranchMessages,
    updateConversation,
  };
}
