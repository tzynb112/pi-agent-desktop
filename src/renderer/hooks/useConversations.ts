import { useState, useRef, useCallback, useEffect } from 'react';
import { Conversation, ChatMessage } from '../types';
import { sanitizeConversations } from '../utils/message-sanitize';
import { safeStorage } from '../utils/storage';

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const saved = safeStorage.getItem('piano-conversations');
    if (saved) {
      try { return sanitizeConversations(JSON.parse(saved)); }
      catch { return []; }
    }
    return [];
  });
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    try {
      const saved = safeStorage.getItem('piano-ui-state');
      if (saved) return JSON.parse(saved).activeConversationId || null;
    } catch {}
    return null;
  });

  const conversationsRef = useRef<Conversation[]>(conversations);

  // Keep ref in sync
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Auto-heal orphaned activeConversationId
  useEffect(() => {
    if (activeConversationId) {
      const exists = conversations.some(c => c.id === activeConversationId);
      if (!exists) {
        setActiveConversationId(conversations.length > 0 ? conversations[0].id : null);
      }
    }
  }, [conversations, activeConversationId]);

  // Persist activeConversationId to piano-ui-state
  useEffect(() => {
    try {
      const saved = safeStorage.getItem('piano-ui-state');
      const existing = saved ? JSON.parse(saved) : {};
      if (existing.activeConversationId !== activeConversationId) {
        existing.activeConversationId = activeConversationId;
        safeStorage.setItem('piano-ui-state', JSON.stringify(existing));
      }
    } catch (e) {
      console.error('Failed to save activeConversationId to piano-ui-state:', e);
    }
  }, [activeConversationId]);

  // Initial sanitization
  useEffect(() => {
    const sanitized = sanitizeConversations(conversationsRef.current);
    const changed = JSON.stringify(sanitized) !== JSON.stringify(conversationsRef.current);
    if (!changed) return;
    conversationsRef.current = sanitized;
    setConversations(sanitized);
    try { safeStorage.setItem('piano-conversations', JSON.stringify(sanitized)); }
    catch (e) { console.error('Failed to save sanitized conversations:', e); }
  }, []);

  const saveConversations = useCallback((convs: Conversation[]) => {
    const sanitized = sanitizeConversations(convs);
    conversationsRef.current = sanitized;
    setConversations(sanitized);
    try { safeStorage.setItem('piano-conversations', JSON.stringify(sanitized)); }
    catch (e) { console.error('Failed to save conversations:', e); }
  }, []);

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
      try { safeStorage.setItem('piano-conversations', JSON.stringify(sanitized)); }
      catch (e) { console.error('Failed to save conversations:', e); }
      return sanitized;
    });
  }, []);

  const activeConversation = conversations.find(c => c.id === activeConversationId) || null;

  return {
    conversations, setConversations,
    activeConversationId, setActiveConversationId,
    activeConversation,
    conversationsRef,
    saveConversations,
    getActiveBranchMessages,
    updateConversation,
  };
}
