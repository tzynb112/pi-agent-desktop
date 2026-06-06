import { useEffect, useCallback } from 'react';
import type { Conversation } from '../types';

interface UseKeyboardShortcutsOptions {
  /** Whether the agent is currently streaming */
  isStreamingRef: React.MutableRefObject<boolean>;
  /** Stop the current generation */
  handleStop: () => void;
  /** Create a new conversation */
  handleNewConversation: () => void;
  /** All conversations */
  conversations: Conversation[];
  /** Active conversation ID */
  activeConversationId: string | null;
  /** Set active conversation */
  setActiveConversationId: (id: string) => void;
  /** Toggle sidebar */
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  /** Toggle file tree */
  setFileTreeCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  /** Open settings modal */
  setSettingsOpen: (open: boolean) => void;
  /** Set draft prompt */
  setDraftPrompt: (draft: { id: number; text: string } | null) => void;
}

/**
 * Global keyboard shortcuts for PianoAgent.
 *
 * | Shortcut | Action |
 * |----------|--------|
 * | Escape | Stop generation |
 * | Ctrl+/ | Focus input |
 * | Ctrl+K | Command palette |
 * | Ctrl+N | New conversation |
 * | Ctrl+L | New conversation (alias) |
 * | Ctrl+B | Toggle sidebar |
 * | Ctrl+E | Toggle file tree |
 * | Ctrl+Shift+S | Open settings |
 * | Ctrl+Shift+E | Export conversation |
 * | Ctrl+G | Run goal |
 * | Ctrl+↑/↓ | Switch conversation |
 */
export function useKeyboardShortcuts({
  isStreamingRef,
  handleStop,
  handleNewConversation,
  conversations,
  activeConversationId,
  setActiveConversationId,
  setSidebarCollapsed,
  setFileTreeCollapsed,
  setSettingsOpen,
  setDraftPrompt,
}: UseKeyboardShortcutsOptions) {
  const handleGlobalKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'INPUT' ||
        target?.isContentEditable;

      // Escape → stop streaming
      if (event.key === 'Escape' && isStreamingRef.current) {
        event.preventDefault();
        handleStop();
        return;
      }

      if (!event.ctrlKey) return;

      // Ctrl+/ → focus input
      if (event.key === '/') {
        event.preventDefault();
        window.dispatchEvent(new Event('piano-focus-input'));
        return;
      }

      // Ctrl+K → command palette (prefill /)
      if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
        event.preventDefault();
        setDraftPrompt({ id: Date.now(), text: '/' });
        window.dispatchEvent(new Event('piano-focus-input'));
        return;
      }

      // Ctrl+N → new conversation
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        handleNewConversation();
        return;
      }

      // Ctrl+L → new conversation (alias)
      if (event.key.toLowerCase() === 'l') {
        event.preventDefault();
        handleNewConversation();
        return;
      }

      // Ctrl+B → toggle sidebar
      if (event.key.toLowerCase() === 'b' && !event.shiftKey) {
        event.preventDefault();
        setSidebarCollapsed((prev) => !prev);
        return;
      }

      // Ctrl+E → toggle file tree
      if (event.key.toLowerCase() === 'e' && !event.shiftKey) {
        event.preventDefault();
        setFileTreeCollapsed((prev) => !prev);
        return;
      }

      // Ctrl+Shift+S → open settings
      if (event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }

      // Ctrl+Shift+E → export
      if (event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        if (!isStreamingRef.current) {
          setDraftPrompt({ id: Date.now(), text: '/export' });
          window.dispatchEvent(new Event('piano-focus-input'));
        }
        return;
      }

      // Ctrl+G → goal
      if (event.key.toLowerCase() === 'g' && !event.shiftKey) {
        event.preventDefault();
        const goalDesc = prompt('请输入目标描述:');
        if (goalDesc) {
          setDraftPrompt({ id: Date.now(), text: `/goal ${goalDesc}` });
          window.dispatchEvent(new Event('piano-focus-input'));
        }
        return;
      }

      // Below shortcuts should not fire when editing text
      if (isEditableTarget) return;

      // Ctrl+↑/↓ → switch conversation
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        if (conversations.length === 0) return;
        const currentIndex = conversations.findIndex(
          (c) => c.id === activeConversationId
        );
        const fallbackIndex = currentIndex === -1 ? 0 : currentIndex;
        const nextIndex =
          event.key === 'ArrowUp'
            ? Math.max(0, fallbackIndex - 1)
            : Math.min(conversations.length - 1, fallbackIndex + 1);
        setActiveConversationId(conversations[nextIndex].id);
      }
    },
    [
      isStreamingRef,
      handleStop,
      handleNewConversation,
      conversations,
      activeConversationId,
      setActiveConversationId,
      setSidebarCollapsed,
      setFileTreeCollapsed,
      setSettingsOpen,
      setDraftPrompt,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);
}
