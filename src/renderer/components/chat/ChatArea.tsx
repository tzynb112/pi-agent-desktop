import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { ChatMessage, Conversation } from '../../types';
import MessageBubble from './MessageBubble';
import GoalStatus from './GoalStatus';
import GoalQueuePanel from './GoalQueuePanel';
import type { Goal, Agent } from '../../../shared/goal-executor';
import type { GoalQueueItem, GoalRunMeta } from '../../types';
import { Rocket, Search, Target } from 'lucide-react';

interface ChatAreaProps {
  conversation: Conversation | null;
  getActiveBranchMessages: (conv: Conversation | null) => ChatMessage[];
  onSwitchBranch: (msgId: string) => void;
  onEditAndFork: (msgId: string, newContent: string) => void;
  onRegenerate: (msgId: string) => void;
  agentName?: string;
  agentAvatar?: string;
  goal?: Goal | null;
  goalAgents?: Agent[];
  goalRunMeta?: GoalRunMeta | null;
  goalQueue?: GoalQueueItem[];
  onResumeGoal?: () => void;
  onPauseGoal?: () => void;
  onDismissGoal?: () => void;
  onOpenGoalConversation?: (conversationId: string) => void;
  onResumeGoalQueueItem?: (goalId: string) => void;
  onPauseGoalQueueItem?: (goalId: string) => void;
  onRemoveGoalQueueItem?: (goalId: string) => void;
  onQuickPrompt?: (prompt: string) => void;
  contextTokens?: number;
}

const VIRTUAL_SCROLL_THRESHOLD = 50;
const ESTIMATED_MSG_HEIGHT = 80;
const OVERSCAN = 10;

const ChatArea: React.FC<ChatAreaProps> = ({
  conversation,
  getActiveBranchMessages,
  onSwitchBranch,
  onEditAndFork,
  onRegenerate,
  agentName = 'PianoAgent',
  agentAvatar = '🧠',
  goal,
  goalAgents,
  goalRunMeta,
  goalQueue = [],
  onResumeGoal,
  onPauseGoal,
  onDismissGoal,
  onOpenGoalConversation,
  onResumeGoalQueueItem,
  onPauseGoalQueueItem,
  onRemoveGoalQueueItem,
  onQuickPrompt,
  contextTokens = 0,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const heightCache = useRef<Map<string, number>>(new Map());
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const activeMessages = useMemo(
    () => (conversation ? getActiveBranchMessages(conversation) : []),
    [conversation, getActiveBranchMessages]
  );

  const filteredMessages = useMemo(
    () => activeMessages.filter(msg => !msg.id.startsWith('tool_res_')),
    [activeMessages]
  );

  const useVirtualScroll = filteredMessages.length > VIRTUAL_SCROLL_THRESHOLD;

  const lastMsg = activeMessages[activeMessages.length - 1];
  const streamFingerprint = lastMsg
    ? `${activeMessages.length}:${lastMsg.content?.length ?? 0}:${lastMsg.isStreaming}`
    : `${activeMessages.length}`;

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 80;
    setUserScrolledUp(!isAtBottom);

    if (useVirtualScroll) {
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        const st = scrollRef.current.scrollTop;
        const ch = scrollRef.current.clientHeight;
        let accHeight = 0;
        let startIdx = 0;
        let endIdx = filteredMessages.length;

        for (let i = 0; i < filteredMessages.length; i++) {
          const h = heightCache.current.get(filteredMessages[i].id) || ESTIMATED_MSG_HEIGHT;
          if (accHeight + h > st) { startIdx = i; break; }
          accHeight += h;
        }
        for (let i = startIdx; i < filteredMessages.length; i++) {
          endIdx = i + 1;
          accHeight += heightCache.current.get(filteredMessages[i].id) || ESTIMATED_MSG_HEIGHT;
          if (accHeight > st + ch) break;
        }

        const s = Math.max(0, startIdx - OVERSCAN);
        const e = Math.min(filteredMessages.length, endIdx + OVERSCAN);
        setVisibleRange(prev => (prev.start === s && prev.end === e ? prev : { start: s, end: e }));
      });
    }
  }, [useVirtualScroll, filteredMessages]);

  useEffect(() => {
    if (scrollRef.current && !userScrolledUp) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: lastMsg?.isStreaming ? 'auto' : 'smooth',
      });
    }
  }, [streamFingerprint, userScrolledUp, lastMsg?.isStreaming]);

  // Measure message heights for virtual scroll
  const measureMsg = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      msgRefs.current.set(id, el);
      const h = el.offsetHeight;
      if (h > 0) heightCache.current.set(id, h);
    }
  }, []);

  // Welcome screen
  if (!conversation || activeMessages.length === 0) {
    return (
      <div className="chat-welcome">
        <div className="chat-welcome-logo logo-glow">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 20V4h6.5a4.5 4.5 0 0 1 0 9H8" />
          </svg>
        </div>

        <h2 className="chat-welcome-title">{agentName}</h2>
        <p className="chat-welcome-subtitle">AI 编程助手 · 在下方输入消息或使用快捷操作</p>

        <div className="chat-welcome-cards">
          {[
            { icon: <Rocket size={18} />, title: '创建新项目', desc: '帮我规划并搭建一个新项目。先检查工作区，然后建议最小可用的第一版方案。', prompt: '帮我规划并搭建一个新项目。先检查工作区，然后建议最小可用的第一版方案。' },
            { icon: <Search size={18} />, title: '代码审查', desc: '审查当前工作区的代码质量，找出潜在问题。', prompt: '/review' },
            { icon: <Target size={18} />, title: '执行目标', desc: '设定长期目标，自动分解为子任务并执行。', prompt: '/goal ' },
          ].map((item) => (
            <button
              key={item.title}
              className="chat-welcome-card"
              onClick={() => onQuickPrompt?.(item.prompt)}
            >
              <div className="chat-welcome-card-icon">{item.icon}</div>
              <div>
                <div className="chat-welcome-card-title">{item.title}</div>
                <div className="chat-welcome-card-desc">{item.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="chat-welcome-shortcuts">
          <span className="chat-welcome-shortcut"><kbd>Ctrl+N</kbd> 新建会话</span>
          <span className="chat-welcome-shortcut"><kbd>Ctrl+Shift+S</kbd> 设置</span>
          <span className="chat-welcome-shortcut"><kbd>/help</kbd> 命令列表</span>
        </div>
      </div>
    );
  }

  // Calculate total estimated height for virtual scroll
  const totalHeight = useVirtualScroll
    ? filteredMessages.reduce((sum, m) => sum + (heightCache.current.get(m.id) || ESTIMATED_MSG_HEIGHT), 0)
    : 0;

  const renderMessage = (msg: ChatMessage, idx: number) => {
    const siblings = conversation
      ? conversation.messages.filter((m) => m.parentId === msg.parentId)
      : [];
    const siblingCount = siblings.length;
    const siblingIndex = siblings.findIndex((s) => s.id === msg.id);

    return (
      <div key={msg.id} ref={(el) => useVirtualScroll && measureMsg(msg.id, el)}>
        <MessageBubble
          message={msg}
          index={idx}
          siblingIndex={siblingIndex}
          siblingCount={siblingCount}
          siblings={siblings}
          onSwitchBranch={onSwitchBranch}
          onEditAndFork={onEditAndFork}
          onRegenerate={onRegenerate}
          agentAvatar={agentAvatar}
        />
      </div>
    );
  };

  return (
    <div className="chat-area-main">
      {goal && (
        <div style={{ maxWidth: 900, width: '100%', margin: '0 auto', padding: '12px 16px 0', boxSizing: 'border-box' }}>
          <GoalStatus goal={goal} agents={goalAgents} meta={goalRunMeta} onResume={onResumeGoal} onCancel={onPauseGoal} onDismiss={onDismissGoal} />
        </div>
      )}
      <div
        ref={scrollRef}
        className="scrollbar-thin chat-area-scroll"
        onScroll={handleScroll}
      >
        <div className="chat-area-inner chat-area-content">
          {contextTokens > 0 && (
            <div className="chat-area-token-badge">
              <span className="chat-area-token-text">
                ~{contextTokens.toLocaleString()} tokens
              </span>
            </div>
          )}
          <GoalQueuePanel
            items={goalQueue}
            activeConversationId={conversation?.id}
            onOpenConversation={onOpenGoalConversation}
            onResume={onResumeGoalQueueItem}
            onPause={onPauseGoalQueueItem}
            onRemove={onRemoveGoalQueueItem}
          />

          {useVirtualScroll ? (
            <div style={{ position: 'relative', minHeight: totalHeight }}>
              {visibleRange.start > 0 && (
                <div style={{ height: filteredMessages.slice(0, visibleRange.start).reduce((s, m) => s + (heightCache.current.get(m.id) || ESTIMATED_MSG_HEIGHT), 0) }} />
              )}
              {filteredMessages.slice(visibleRange.start, visibleRange.end).map((msg, i) =>
                renderMessage(msg, visibleRange.start + i)
              )}
            </div>
          ) : (
            filteredMessages.map((msg, index) => renderMessage(msg, index))
          )}
        </div>
      </div>

      {/* Scroll to bottom button */}
      {userScrolledUp && (
        <button
          className="scroll-to-bottom"
          onClick={() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
            setUserScrolledUp(false);
          }}
          title="回到最新"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v10M4 9l4 4 4-4" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default ChatArea;
