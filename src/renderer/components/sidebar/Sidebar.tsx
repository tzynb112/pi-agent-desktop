import React from 'react';
import { Conversation } from '../../types';
import ConversationItem from './ConversationItem';
import { Plus, PanelLeftClose, PanelLeft, Search } from 'lucide-react';

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width?: number;
}

const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeConversationId,
  onSelect,
  onNew,
  onDelete,
  collapsed,
  onToggleCollapse,
  width,
}) => {
  const [searchQuery, setSearchQuery] = React.useState('');

  const filtered = conversations.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    if (c.title.toLowerCase().includes(q)) return true;
    return c.messages.some((m) => (m.content || '').toLowerCase().includes(q));
  });

  const grouped = React.useMemo(() => {
    const now = Date.now();
    const day = 86400000;
    const groups: { label: string; items: Conversation[] }[] = [];
    const today: Conversation[] = [];
    const yesterday: Conversation[] = [];
    const thisWeek: Conversation[] = [];
    const older: Conversation[] = [];

    filtered.forEach((c) => {
      const diff = now - c.updatedAt;
      if (diff < day) today.push(c);
      else if (diff < day * 2) yesterday.push(c);
      else if (diff < day * 7) thisWeek.push(c);
      else older.push(c);
    });

    if (today.length) groups.push({ label: '今天', items: today });
    if (yesterday.length) groups.push({ label: '昨天', items: yesterday });
    if (thisWeek.length) groups.push({ label: '本周', items: thisWeek });
    if (older.length) groups.push({ label: '更早', items: older });

    return groups;
  }, [filtered]);

  if (collapsed) {
    return (
      <div className="sidebar-collapsed">
        <button className="sidebar-icon-btn" onClick={onToggleCollapse} title="展开侧边栏">
          <PanelLeft size={16} />
        </button>
        <button className="sidebar-icon-btn sidebar-icon-btn--accent" onClick={onNew} title="新建会话">
          <Plus size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar animate-slide-right" style={{ width: width || 280, minWidth: width || 280 }}>
      <div className="sidebar-header">
        <div className="sidebar-search-wrap">
          <Search size={14} className="sidebar-search-icon" />
          <input
            type="text"
            className="sidebar-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话..."
          />
          {conversations.length > 0 && !searchQuery && (
            <span className="sidebar-search-count">{conversations.length}</span>
          )}
        </div>
        <button className="sidebar-icon-btn" onClick={onToggleCollapse} title="收起侧边栏">
          <PanelLeftClose size={16} />
        </button>
      </div>

      <button className="sidebar-new-btn" onClick={onNew}>
        <Plus size={14} />
        新建会话
      </button>

      <div className="scrollbar-thin sidebar-list">
        {grouped.map((group) => (
          <div key={group.label} className="sidebar-group">
            <div className="sidebar-group-header">{group.label}</div>
            {group.items.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={() => onSelect(conv.id)}
                onDelete={() => onDelete(conv.id)}
              />
            ))}
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="sidebar-empty">
            {searchQuery ? '没有找到匹配的会话' : '还没有会话'}
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;