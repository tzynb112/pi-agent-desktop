import { memo } from 'react';
import type { GoalQueueItem } from '../../types';

interface GoalQueuePanelProps {
  items: GoalQueueItem[];
  activeConversationId?: string | null;
  onOpenConversation?: (conversationId: string) => void;
  onResume?: (goalId: string) => void;
  onPause?: (goalId: string) => void;
  onRemove?: (goalId: string) => void;
}

const statusLabel: Record<GoalQueueItem['status'], string> = {
  queued: '排队', running: '运行', paused: '暂停', failed: '失败', completed: '完成',
};

const statusColor: Record<GoalQueueItem['status'], string> = {
  queued: 'var(--text-muted)', running: 'var(--accent-primary)', paused: '#f59e0b',
  failed: 'var(--status-error)', completed: 'var(--status-success)',
};

const eventColor: Record<string, string> = {
  created: 'var(--text-muted)', updated: 'var(--text-muted)', heartbeat: 'var(--text-muted)',
  manual_continue: 'var(--accent-primary)', paused: '#f59e0b', removed: 'var(--text-muted)',
  scheduled: 'var(--accent-primary)', auto_resume: 'var(--accent-primary)',
  recovered: '#f59e0b', failed: 'var(--status-error)', completed: 'var(--status-success)',
};

const formatTime = (value?: number) => {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const isStaleRunning = (item: GoalQueueItem) => {
  if (item.status !== 'running') return false;
  const heartbeatAt = item.meta?.lastHeartbeatAt || item.updatedAt || item.createdAt;
  return Date.now() - heartbeatAt > 60_000;
};

const GoalQueuePanel: React.FC<GoalQueuePanelProps> = ({
  items, activeConversationId, onOpenConversation, onResume, onPause, onRemove,
}) => {
  const visibleItems = items
    .filter((item) => item.status !== 'completed' && item.conversationId !== activeConversationId)
    .slice(0, 5);
  if (visibleItems.length === 0) return null;

  return (
    <div className="gqp">
      <div className="gqp-header">
        <div className="gqp-title">后台目标队列</div>
        <div className="gqp-count">{visibleItems.length} 个未完成</div>
      </div>
      <div className="gqp-list">
        {visibleItems.map((item) => (
          <div key={item.id} className={'gqp-item' + (item.conversationId === activeConversationId ? ' gqp-item--active' : '')}>
            <div style={{ minWidth: 0 }}>
              <div className="gqp-item-title">{item.title || item.description}</div>
              <div className="gqp-item-meta">
                上次同步 {formatTime(item.meta?.lastHeartbeatAt)}  ·  失败 {item.meta?.failureCount || 0}
                {item.parentGoalId ? '  ·  续链 ' + (item.resumeChain?.length || 1) : ''}  ·  {item.meta?.statusNote || '等待调度'}
              </div>
              {(item.history || []).slice(-3).reverse().map((event) => (
                <div
                  key={event.id}
                  className="gqp-item-event"
                  style={{ color: eventColor[event.type] || 'var(--text-muted)' }}
                  title={new Date(event.at).toLocaleString() + '  ·  ' + event.message}
                >
                  {formatTime(event.at)}  ·  {event.message}
                </div>
              ))}
            </div>
            <span className="gqp-status" style={{ color: statusColor[item.status] }}>
              {isStaleRunning(item) ? '可能卡住' : statusLabel[item.status]}
            </span>
            <div className="gqp-actions">
              {item.status !== 'running' && (
                <button className="gqp-btn gqp-btn--primary" onClick={() => onResume?.(item.id)}>继续</button>
              )}
              {item.meta?.autoResumeEnabled && (
                <button className="gqp-btn" onClick={() => onPause?.(item.id)}>暂停</button>
              )}
              <button className="gqp-btn" onClick={() => onOpenConversation?.(item.conversationId)}>打开</button>
              <button className="gqp-btn gqp-btn--muted" onClick={() => onRemove?.(item.id)}>移除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default memo(GoalQueuePanel);