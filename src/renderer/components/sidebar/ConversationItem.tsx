import React, { useState, memo } from 'react';
import { Conversation } from '../../types';
import { MessageSquare, Trash2 } from 'lucide-react';

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  onSelect,
  onDelete,
}) => {
  const [showDelete, setShowDelete] = useState(false);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    return (d.getMonth() + 1) + '/' + d.getDate();
  };

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
      className={'sidebar-conv-item' + (isActive ? ' sidebar-conv-item--active' : '')}
    >
      <div className="conv-item-row">
        <div className={'conv-item-icon ' + (isActive ? 'conv-item-icon--active' : 'conv-item-icon--inactive')}>
          <MessageSquare size={13} style={{ color: isActive ? 'white' : 'var(--text-muted)' }} />
        </div>
        <div className="conv-item-body">
          <div className={'conv-item-title ' + (isActive ? 'conv-item-title--active' : 'conv-item-title--inactive')}>
            {conversation.title}
          </div>
          {conversation.messages.length > 0 && (
            <div className="conv-item-preview">
              {(conversation.messages[conversation.messages.length - 1]?.content || '').substring(0, 50)}
            </div>
          )}
          <div className="conv-item-meta">
            <span>{formatTime(conversation.updatedAt)}</span>
            <span className="conv-item-meta-dot">{'\u00B7'}</span>
            <span>{conversation.messages.length} msgs</span>
          </div>
        </div>
        {showDelete && (
          <button
            className="conv-item-delete"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
};

export default memo(ConversationItem);