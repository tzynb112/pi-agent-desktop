import React, { useState, memo } from 'react';
import { Target, CheckCircle, XCircle, Clock, Loader, Heart, ChevronDown, ChevronRight, Info } from 'lucide-react';
import type { Goal, SubTask, Agent } from '../../../shared/goal-executor';
import type { GoalRunMeta } from '../../types';

interface GoalStatusProps {
  goal: Goal;
  agents?: Agent[];
  meta?: GoalRunMeta | null;
  onRetry?: (taskId: string) => void;
  onCancel?: () => void;
  onResume?: () => void;
  onDismiss?: () => void;
}

import { safeStorage } from '../../utils/storage';

const GoalStatus: React.FC<GoalStatusProps> = ({ goal, agents, meta, onRetry, onCancel, onResume, onDismiss }) => {
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [height, setHeight] = useState<number>(() => {
    const saved = safeStorage.getItem('goal_status_height');
    return saved ? parseInt(saved, 10) : 260;
  });

  const toggleTask = (idx: number) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(120, Math.min(800, startHeight + (moveEvent.clientY - startY)));
      setHeight(newHeight);
      safeStorage.setItem('goal_status_height', String(newHeight));
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const formatTime = (value?: number) => {
    if (!value) return '-';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getStatusLabel = (s: string) => {
    const map: Record<string, string> = { pending: '等待调度', planning: '正在规划', executing: '正在执行', completed: '任务已完成', failed: '执行失败' };
    return map[s] || s;
  };

  const getStatusBadge = (status: string) => (
    <span className={'goal-badge goal-badge--' + status}>
      {status === 'executing' && <span className="status-pulse status-pulse--running" />}
      {status === 'planning' && <Loader size={9} className="goal-spinner goal-status-icon-info" />}
      {getStatusLabel(status)}
    </span>
  );

  const completedTasks = goal.subTasks.filter(t => t.status === 'completed').length;
  const totalTasks = goal.subTasks.length;
  const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  const activeTask = goal.subTasks.find((task) => task.status === 'executing');
  const pendingTask = goal.subTasks.find((task) => task.status === 'pending');

  const liveStageText = (() => {
    if (goal.status === 'planning') {
      return '正在生成执行计划';
    }
    if (goal.status === 'executing') {
      if (activeTask) {
        const pct = activeTask.progress !== undefined ? ` ${Math.round(activeTask.progress)}%` : '';
        return `正在执行子任务：${activeTask.description}${pct}`;
      }
      if (pendingTask) {
        return `等待调度子任务：${pendingTask.description}`;
      }
      return '正在执行目标';
    }
    if (goal.status === 'completed') {
      return '目标已完成';
    }
    if (goal.status === 'failed') {
      return '目标执行失败';
    }
    return '等待开始';
  })();

  const getSubTaskIcon = (status: string) => {
    // If the overall goal is not active, any active loader should render as pending/paused Clock icon
    const isActiveGoal = goal.status === 'executing' || goal.status === 'planning';
    const effectiveStatus = (status === 'executing' && !isActiveGoal) ? 'pending' : status;

    switch (effectiveStatus) {
      case 'completed': return <CheckCircle size={14} className="goal-status-icon-success" />;
      case 'failed': return <XCircle size={14} className="goal-status-icon-error" />;
      case 'executing': return <Loader size={14} className="goal-spinner goal-status-icon-accent" />;
      case 'planning': return <Clock size={14} className="goal-status-icon-info" />;
      default: return <Clock size={14} className="goal-status-icon-muted" />;
    }
  };

  return (
    <div 
      className={'goal-card goal-card--' + goal.status}
      style={{
        height: height,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* Scrollable contents */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }} className="scrollbar-thin">
        {/* Header */}
        <div className="goal-header">
          <div className="goal-header-left">
            <div className="goal-header-icon">
              <Target size={16} className="goal-status-icon-accent" />
            </div>
            <div className="goal-header-info">
              <div className="goal-header-title-row">
                <span className="goal-header-title">自动续跑目标 (Goal Active State)</span>
                {getStatusBadge(goal.status)}
              </div>
              <div className="goal-description" title={goal.description}>{goal.description}</div>
            </div>
          </div>
          <div className="goal-header-actions">
            {onCancel && goal.status === 'executing' && (
              <button className="goal-action-btn" onClick={onCancel}>暂停目标</button>
            )}
            {onResume && goal.status !== 'completed' && goal.status !== 'executing' && (
              <button className="goal-action-btn goal-action-btn--primary" onClick={onResume}>继续执行</button>
            )}
            {onDismiss && goal.status !== 'executing' && (
              <button className="goal-action-btn" onClick={onDismiss}>清除记录</button>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="goal-progress-section">
          <div className="goal-progress-header">
            <span className="goal-progress-label">
              排期进度: {completedTasks}/{totalTasks} 任务 ({Math.round(progress)}%)
            </span>
            {meta && (
              <div className="goal-meta">
                <span className="goal-meta-item goal-meta-heartbeat">
                  <Heart size={10} className="goal-heartbeat-icon" />
                  上次同步: {formatTime(meta.lastHeartbeatAt)}
                </span>
                {meta.failureCount > 0 && (
                  <span className="goal-meta-item goal-meta-failure">
                    失败: {meta.failureCount}次
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="goal-progress-bar">
            <div className="goal-progress-fill" style={{ width: progress + '%', background: goal.status === 'failed' ? 'var(--status-error)' : 'var(--accent-primary)' }} />
          </div>
          <div className="goal-status-note-bar" style={{ marginTop: 8 }}>
            <Info size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span className="goal-status-note-text" style={{ marginLeft: 2 }}>
              {liveStageText}
            </span>
          </div>
          {meta?.statusNote && (
            <div className="goal-status-note-bar">
              <Info size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span className="goal-status-note-text" style={{ marginLeft: 2 }}>{meta.statusNote}</span>
            </div>
          )}
        </div>

        {/* Agents */}
        {agents && agents.length > 0 && (
          <>
            <div className="goal-section-title">Agents ({agents.length})</div>
            <div className="goal-agents-list">
              {agents.map((agent, i) => (
                <div key={i} className="goal-agent-item">
                  <span className="goal-agent-name">{agent.name}</span>
                  <span className="goal-agent-role">{agent.capabilities?.join(', ') || ''}</span>
                  <span className="goal-agent-status">{agent.status === 'busy' ? <span className="status-pulse status-pulse--running" /> : null}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Subtasks */}
        {goal.subTasks.length > 0 && (
          <div className="goal-subtasks-divider">
            <div className="goal-section-title">规划任务流 (Execution Pipeline)</div>
            <div className="goal-subtasks-list">
              {goal.subTasks.map((task, idx) => (
                <div key={idx} className={'goal-subtask' + (task.status === 'executing' ? ' goal-subtask--active' : '')}>
                  <button className="goal-subtask-header" onClick={() => toggleTask(idx)}>
                    <span className="goal-subtask-id">#{idx + 1}</span>
                    {getSubTaskIcon(task.status)}
                    <span className="goal-subtask-name">{task.description || ('子任务 ' + (idx + 1))}</span>
                    <span className="goal-subtask-chevron">
                      {expandedTasks.has(idx) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                  </button>

                  {expandedTasks.has(idx) && (
                    <div className="goal-subtask-content">
                      {task.status === 'completed' && (
                        task.result ? (
                          <pre className="scrollbar-thin goal-subtask-result">{task.result}</pre>
                        ) : (
                          <div className="goal-subtask-success-msg">该任务已成功执行完成。</div>
                        )
                      )}

                      {task.status === 'failed' && (
                        <div className="goal-error-block">
                          <div className="goal-error-title">执行失败，错误信息：</div>
                          <pre className="goal-error-pre">{task.error || '未知错误'}</pre>
                        </div>
                      )}

                      {task.status === 'executing' && (
                        <div className="goal-executing-info">
                          <div className="goal-executing-progress">
                            {goal.status === 'executing' ? '正在执行中' : '已暂停/中断'} — 进度 {task.progress !== undefined ? Math.round(task.progress) : 0}%
                          </div>
                          {task.currentTool && (
                            <div className="goal-tool-indicator">
                              <span className="goal-pulse-dot" />
                              <div className="goal-tool-info">
                                <div className="goal-tool-name">{task.currentTool.name}</div>
                                <div className="goal-tool-target" title={task.currentTool.target}>{task.currentTool.target}</div>
                              </div>
                            </div>
                          )}
                          {task.recentTools && task.recentTools.length > 0 && (
                            <div className="goal-recent-tools">
                              <div className="goal-recent-tools-title">最近操作：</div>
                              {task.recentTools.slice(-5).reverse().map((tool, ti) => (
                                <div key={ti} className={'goal-recent-tool-item ' + (tool.success ? 'goal-recent-tool-item--success' : 'goal-recent-tool-item--error') + (ti === 0 ? '' : ' goal-recent-tool-faded')}>
                                  <span className="goal-recent-tool-icon">{tool.success ? 'pass' : 'fail'}</span>
                                  <span className="goal-recent-tool-name">{tool.name}</span>
                                  <span className="goal-recent-tool-target" title={tool.target}>{tool.target}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {task.status === 'pending' && (
                        <div className="goal-pending-msg">
                          <div className="goal-pending-title">等待执行中</div>
                          <div className="goal-pending-desc">该子任务正处于等待序列，将在前序任务完成或调度资源空闲时自动开启。</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Resize Handle at the bottom */}
      <div className="goal-resize-handle" onMouseDown={handleMouseDown} />
    </div>
  );
};

export default memo(GoalStatus);
