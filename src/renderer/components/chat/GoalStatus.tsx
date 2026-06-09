import React, { memo, useState } from 'react';
import {
  Target,
  CheckCircle,
  XCircle,
  Clock,
  Loader,
  Heart,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react';
import type { Goal, SubTask, Agent } from '../../../shared/goal-executor';
import type { GoalRunMeta } from '../../types';
import { safeStorage } from '../../utils/storage';

interface GoalStatusProps {
  goal: Goal;
  agents?: Agent[];
  meta?: GoalRunMeta | null;
  onRetry?: (taskId: string) => void;
  onCancel?: () => void;
  onResume?: () => void;
  onDismiss?: () => void;
}

const GoalStatus: React.FC<GoalStatusProps> = ({ goal, agents, meta, onCancel, onResume, onDismiss }) => {
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [height, setHeight] = useState<number>(() => {
    const saved = safeStorage.getItem('goal_status_height');
    return saved ? parseInt(saved, 10) : 260;
  });

  const toggleTask = (idx: number) => {
    setExpandedTasks((prev) => {
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

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      pending: 'Queued',
      planning: 'Planning',
      executing: 'Running',
      completed: 'Completed',
      failed: 'Failed',
    };
    return map[status] || status;
  };

  const getStatusBadge = (status: string) => (
    <span className={'goal-badge goal-badge--' + status}>
      {status === 'executing' && <span className="status-pulse status-pulse--running" />}
      {status === 'planning' && <Loader size={9} className="goal-spinner goal-status-icon-info" />}
      {getStatusLabel(status)}
    </span>
  );

  const completedTasks = goal.subTasks.filter((task) => task.status === 'completed').length;
  const totalTasks = goal.subTasks.length;
  const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  const activeTask = goal.subTasks.find((task) => task.status === 'executing');
  const pendingTask = goal.subTasks.find((task) => task.status === 'pending');

  const liveStageText = (() => {
    if (goal.status === 'planning') return 'Building the execution plan';
    if (goal.status === 'executing') {
      if (activeTask) {
        const pct = activeTask.progress !== undefined ? ` ${Math.round(activeTask.progress)}%` : '';
        return `Running subtask: ${activeTask.description}${pct}`;
      }
      if (pendingTask) return `Waiting to schedule: ${pendingTask.description}`;
      return 'Running goal';
    }
    if (goal.status === 'completed') return 'Goal completed';
    if (goal.status === 'failed') return 'Goal execution stopped';
    return 'Waiting to start';
  })();

  const getSubTaskIcon = (status: string) => {
    const isActiveGoal = goal.status === 'executing' || goal.status === 'planning';
    const effectiveStatus = status === 'executing' && !isActiveGoal ? 'pending' : status;

    switch (effectiveStatus) {
      case 'completed':
        return <CheckCircle size={14} className="goal-status-icon-success" />;
      case 'failed':
        return <XCircle size={14} className="goal-status-icon-error" />;
      case 'executing':
        return <Loader size={14} className="goal-spinner goal-status-icon-accent" />;
      case 'planning':
        return <Clock size={14} className="goal-status-icon-info" />;
      default:
        return <Clock size={14} className="goal-status-icon-muted" />;
    }
  };

  const renderVerificationBlock = (task: SubTask) => {
    const evidence = task.verificationEvidence || [];
    const verified = !!task.verified;
    const changedCount = task.filesChanged?.length || 0;
    const showPending = task.status === 'completed' && changedCount > 0 && !verified;

    if (!verified && !showPending && evidence.length === 0) {
      return null;
    }

    return (
      <div className={'goal-verification-block' + (verified ? ' goal-verification-block--verified' : ' goal-verification-block--pending')}>
        <div className="goal-verification-header">
          <span className={'goal-verification-badge' + (verified ? ' goal-verification-badge--verified' : ' goal-verification-badge--pending')}>
            {verified ? 'Verified' : 'Needs verification'}
          </span>
          {changedCount > 0 && <span className="goal-verification-files">Changed files {changedCount}</span>}
        </div>
        {evidence.length > 0 && (
          <div className="goal-verification-evidence">
            {evidence.map((item, index) => (
              <div key={index} className="goal-verification-evidence-item" title={item}>
                {item}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={'goal-card goal-card--' + goal.status}
      style={{
        height,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }} className="scrollbar-thin">
        <div className="goal-header">
          <div className="goal-header-left">
            <div className="goal-header-icon">
              <Target size={16} className="goal-status-icon-accent" />
            </div>
            <div className="goal-header-info">
              <div className="goal-header-title-row">
                <span className="goal-header-title">Goal Active State</span>
                {getStatusBadge(goal.status)}
              </div>
              <div className="goal-description" title={goal.description}>{goal.description}</div>
            </div>
          </div>
          <div className="goal-header-actions">
            {onCancel && goal.status === 'executing' && (
              <button className="goal-action-btn" onClick={onCancel}>Pause goal</button>
            )}
            {onResume && goal.status !== 'completed' && goal.status !== 'executing' && (
              <button className="goal-action-btn goal-action-btn--primary" onClick={onResume}>Resume</button>
            )}
            {onDismiss && goal.status !== 'executing' && (
              <button className="goal-action-btn" onClick={onDismiss}>Dismiss</button>
            )}
          </div>
        </div>

        <div className="goal-progress-section">
          <div className="goal-progress-header">
            <span className="goal-progress-label">
              Progress: {completedTasks}/{totalTasks} tasks ({Math.round(progress)}%)
            </span>
            {meta && (
              <div className="goal-meta">
                <span className="goal-meta-item goal-meta-heartbeat">
                  <Heart size={10} className="goal-heartbeat-icon" />
                  Last sync: {formatTime(meta.lastHeartbeatAt)}
                </span>
                {meta.failureCount > 0 && (
                  <span className="goal-meta-item goal-meta-failure">
                    Failures: {meta.failureCount}
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
            <span className="goal-status-note-text" style={{ marginLeft: 2 }}>{liveStageText}</span>
          </div>
          {meta?.statusNote && (
            <div className="goal-status-note-bar">
              <Info size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span className="goal-status-note-text" style={{ marginLeft: 2 }}>{meta.statusNote}</span>
            </div>
          )}
        </div>

        {agents && agents.length > 0 && (
          <>
            <div className="goal-section-title">Agents ({agents.length})</div>
            <div className="goal-agents-list">
              {agents.map((agent, index) => (
                <div key={index} className="goal-agent-item">
                  <span className="goal-agent-name">{agent.name}</span>
                  <span className="goal-agent-role">{agent.capabilities?.join(', ') || ''}</span>
                  <span className="goal-agent-status">{agent.status === 'busy' ? <span className="status-pulse status-pulse--running" /> : null}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {goal.subTasks.length > 0 && (
          <div className="goal-subtasks-divider">
            <div className="goal-section-title">Execution Pipeline</div>
            <div className="goal-subtasks-list">
              {goal.subTasks.map((task, idx) => (
                <div key={idx} className={'goal-subtask' + (task.status === 'executing' ? ' goal-subtask--active' : '')}>
                  <button className="goal-subtask-header" onClick={() => toggleTask(idx)}>
                    <span className="goal-subtask-id">#{idx + 1}</span>
                    {getSubTaskIcon(task.status)}
                    <span className="goal-subtask-name">{task.description || `Task ${idx + 1}`}</span>
                    <span className="goal-subtask-chevron">
                      {expandedTasks.has(idx) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                  </button>

                  {expandedTasks.has(idx) && (
                    <div className="goal-subtask-content">
                      {(task.status === 'completed' || task.status === 'executing' || task.status === 'pending') && renderVerificationBlock(task)}

                      {task.status === 'completed' && (
                        task.result ? (
                          <pre className="scrollbar-thin goal-subtask-result">{task.result}</pre>
                        ) : (
                          <div className="goal-subtask-success-msg">This task completed successfully.</div>
                        )
                      )}

                      {task.status === 'failed' && (
                        <div className="goal-error-block">
                          <div className="goal-error-title">Execution failed</div>
                          <pre className="goal-error-pre">{task.error || 'Unknown error'}</pre>
                        </div>
                      )}

                      {task.status === 'executing' && (
                        <div className="goal-executing-info">
                          <div className="goal-executing-progress">
                            {goal.status === 'executing' ? 'Running' : 'Paused'} - Progress {task.progress !== undefined ? Math.round(task.progress) : 0}%
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
                              <div className="goal-recent-tools-title">Recent actions</div>
                              {task.recentTools.slice(-5).reverse().map((tool, toolIndex) => (
                                <div key={toolIndex} className={'goal-recent-tool-item ' + (tool.success ? 'goal-recent-tool-item--success' : 'goal-recent-tool-item--error') + (toolIndex === 0 ? '' : ' goal-recent-tool-faded')}>
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
                          <div className="goal-pending-title">Waiting to run</div>
                          <div className="goal-pending-desc">This subtask will start automatically when dependencies are complete and an agent is free.</div>
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

      <div className="goal-resize-handle" onMouseDown={handleMouseDown} />
    </div>
  );
};

export default memo(GoalStatus);
