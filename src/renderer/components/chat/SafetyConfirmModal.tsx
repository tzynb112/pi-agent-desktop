import React, { useEffect, memo } from 'react';
import { AlertTriangle } from 'lucide-react';

export interface SafetyConfirmState {
  isOpen: boolean;
  cmd: string;
  matchedKeyword: string;
  resolve: (approved: boolean) => void;
}

interface SafetyConfirmModalProps {
  safetyConfirm: SafetyConfirmState;
}

const SafetyConfirmModal: React.FC<SafetyConfirmModalProps> = ({ safetyConfirm }) => {
  useEffect(() => {
    if (!safetyConfirm?.isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        safetyConfirm.resolve(true);
      } else if (e.key === 'b' || e.key === 'B' || e.key === 'Escape') {
        e.preventDefault();
        safetyConfirm.resolve(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [safetyConfirm]);

  if (!safetyConfirm?.isOpen) return null;

  return (
    <div className="safety-overlay">
      <div className="safety-modal" style={{ maxWidth: 550, border: '1px solid rgba(244, 63, 94, 0.4)', boxShadow: '0 12px 40px rgba(244, 63, 94, 0.18)' }}>
        {/* Terminal Title Bar */}
        <div className="safety-terminal-bar">
          <div className="safety-terminal-dots">
            <div className="safety-terminal-dot" style={{ background: 'var(--status-error)' }} />
            <div className="safety-terminal-dot" style={{ background: 'var(--status-warning)' }} />
            <div className="safety-terminal-dot" style={{ background: 'var(--status-success)' }} />
          </div>
          <div className="safety-terminal-title">pi-cli-guard -- security-core</div>
          <div style={{ width: 42 }} />
        </div>

        {/* Modal Body */}
        <div className="safety-modal-body">
          {/* Warning Header */}
          <div className="safety-warning-header">
            <div className="safety-warning-icon">
              <AlertTriangle size={20} style={{ color: 'var(--status-error)' }} />
            </div>
            <div>
              <div className="safety-warning-title">HIGH-RISK COMMAND INTERCEPTED</div>
              <div className="safety-warning-subtitle">System command execution safety check</div>
            </div>
          </div>

          {/* Warning Details */}
          <div className="safety-warning-desc">
            检测到 AI 尝试在您的宿主机运行可能具有破坏性的指令（触发词：
            <span className="safety-keyword-tag">{safetyConfirm.matchedKeyword}</span>
            ）：
          </div>

          {/* Console Code Box */}
          <div className="safety-console">
            <div className="safety-console-header">
              <span>SH - INTERACTIVE SESSION</span>
              <span>TIMEOUT: 120s</span>
            </div>
            <div className="safety-console-body">
              <span className="safety-cmd-dollar">$</span>
              <pre className="safety-cmd-text">{safetyConfirm.cmd}</pre>
            </div>
          </div>

          {/* Prompt */}
          <div className="safety-prompt">
            请问您是否批准执行此命令？建议对未知指令选择"安全拦截"。
            <div className="safety-prompt-hint">
              快捷键提示：按 <kbd className="safety-kbd">A</kbd> 批准执行 · 按 <kbd className="safety-kbd">B</kbd> / <kbd className="safety-kbd">Esc</kbd> 拦截操作
            </div>
          </div>

          {/* Actions */}
          <div className="safety-actions">
            <button className="safety-btn safety-btn--block" onClick={() => safetyConfirm.resolve(false)}>
              [B] 安全拦截 (Block)
            </button>
            <button className="safety-btn safety-btn--approve" onClick={() => safetyConfirm.resolve(true)}>
              [A] 批准执行 (Approve)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(SafetyConfirmModal);
