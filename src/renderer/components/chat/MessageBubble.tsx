import React, { useState, useEffect, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ChatMessage, ToolCall } from '../../types';
import { Copy, Check, ChevronRight, ChevronLeft, User, Edit2, RefreshCw, ChevronDown } from 'lucide-react';
import ToolCallBlock from './ToolCallBlock';

interface MessageBubbleProps {
  message: ChatMessage;
  index: number;
  siblingIndex?: number;
  siblingCount?: number;
  siblings?: ChatMessage[];
  onSwitchBranch?: (msgId: string) => void;
  onEditAndFork?: (msgId: string, newContent: string) => void;
  onRegenerate?: (msgId: string) => void;
  agentAvatar?: string;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  index,
  siblingIndex = 0,
  siblingCount = 1,
  siblings = [],
  onSwitchBranch,
  onEditAndFork,
  onRegenerate,
  agentAvatar = '🧠',
}) => {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [elapsed, setElapsed] = useState(0);
  const [compactionExpanded, setCompactionExpanded] = useState(false);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const isUser = message.role === 'user';
  const isCompactionSummary = message.role === 'system' && message.content?.includes('[历史对话已压缩');

  useEffect(() => {
    if (!message.isStreaming) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [message.isStreaming]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = () => {
    if (onEditAndFork && editContent !== message.content) {
      onEditAndFork(message.id, editContent);
    }
    setIsEditing(false);
  };

  return (
    <div
      className="animate-slide-up msg-bubble-wrapper"
      style={{ animationDelay: (index * 30) + 'ms', animationFillMode: 'both' }}
    >
      <div className={'msg-row msg-row--' + (isUser ? 'user' : 'assistant')}>
        {/* Avatar */}
        <div className={'msg-avatar msg-avatar--' + (isUser ? 'user' : 'assistant')}>
          {isUser ? <User size={13} /> : <span>{agentAvatar}</span>}
        </div>

        <div className={'msg-content-area msg-content-area--' + (isUser ? 'user' : 'assistant')}>
          {/* Reasoning block */}
          {!isUser && message.reasoningContent && (
            <div className="reasoning-block">
              <button
                className="reasoning-toggle"
                onClick={() => setReasoningExpanded(!reasoningExpanded)}
              >
                {reasoningExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>💭 推理过程</span>
              </button>
              <div
                style={{
                  maxHeight: reasoningExpanded ? 300 : 0,
                  overflow: 'hidden',
                  transition: 'max-height 300ms cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                <div className="reasoning-content">
                  {message.reasoningContent}
                </div>
              </div>
            </div>
          )}

          {/* Message content */}
          <div className={isUser ? 'user-bubble' : 'assistant-bubble assistant-light-bar'}>
            {isCompactionSummary ? (
              <div>
                <button
                  onClick={() => setCompactionExpanded(!compactionExpanded)}
                  className="compaction-toggle"
                >
                  {compactionExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span>历史对话已压缩（点击展开）</span>
                </button>
                {compactionExpanded && (
                  <div className="compaction-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            ) : isEditing ? (
              <div>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="composer-input edit-textarea"
                  autoFocus
                />
                <div className="edit-actions">
                  <button className="msg-action-btn" onClick={handleSaveEdit}>保存</button>
                  <button className="msg-action-btn" onClick={() => setIsEditing(false)}>取消</button>
                </div>
              </div>
            ) : (
              <div className="msg-markdown-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ node, inline, className, children, ...props }: any) {
                      const match = /language-(\w+)/.exec(className || '');
                      const codeStr = String(children).replace(/\n$/, '');
                      if (!inline && match) {
                        return (
                          <div className="code-block-wrapper">
                            <div className="code-lang-label">
                              {match[1]}
                            </div>
                            <SyntaxHighlighter
                              style={oneDark}
                              language={match[1]}
                              PreTag="div"
                              customStyle={{ borderRadius: 0, fontSize: 12.5, margin: 0, border: 'none', background: 'transparent' }}
                            >
                              {codeStr}
                            </SyntaxHighlighter>
                          </div>
                        );
                      }
                      return <code className={className} {...props}>{children}</code>;
                    },
                  }}
                >
                  {message.content || ''}
                </ReactMarkdown>
                {message.isStreaming && <span className="typing-cursor" />}
                {message.isStreaming && elapsed > 0 && (
                  <span className="stream-elapsed">
                    {elapsed}s
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="tool-calls-container">
              {message.toolCalls.map((tc) => (
                <ToolCallBlock key={tc.id} toolCall={tc} />
              ))}
            </div>
          )}

          {/* Branch navigation */}
          {siblingCount > 1 && (
            <div className="branch-nav">
              <button
                className="branch-nav-btn"
                onClick={() => {
                  const prevIdx = (siblingIndex - 1 + siblingCount) % siblingCount;
                  onSwitchBranch?.(siblings[prevIdx].id);
                }}
              >
                <ChevronLeft size={10} />
              </button>
              <span className="branch-nav-label">{siblingIndex + 1}/{siblingCount}</span>
              <button
                className="branch-nav-btn"
                onClick={() => {
                  const nextIdx = (siblingIndex + 1) % siblingCount;
                  onSwitchBranch?.(siblings[nextIdx].id);
                }}
              >
                <ChevronRight size={10} />
              </button>
            </div>
          )}

          {/* Action buttons */}
          {isUser ? (
            !isEditing && (
              <div className="message-actions msg-actions--user">
                <button className="msg-action-btn" onClick={() => setIsEditing(true)}>
                  <Edit2 size={10} /> 编辑
                </button>
              </div>
            )
          ) : (
            message.content && (
              <div className="message-actions msg-actions--assistant">
                <button className="msg-action-btn" onClick={handleCopy}>
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? '已复制' : '复制'}
                </button>
                {onRegenerate && !message.isStreaming && (
                  <button
                    className="msg-action-btn msg-action-btn--regenerate"
                    onClick={() => onRegenerate(message.id)}
                    title="重新从此步生成响应（创建新分支）"
                  >
                    <RefreshCw size={11} /> 重新生成
                  </button>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(MessageBubble, (prev, next) => {
  return (
    prev.message.content === next.message.content &&
    prev.message.isStreaming === next.message.isStreaming &&
    prev.message.toolCalls === next.message.toolCalls &&
    prev.message.reasoningContent === next.message.reasoningContent &&
    prev.siblingIndex === next.siblingIndex &&
    prev.siblingCount === next.siblingCount
  );
});