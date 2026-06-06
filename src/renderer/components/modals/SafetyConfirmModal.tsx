import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface SafetyConfirmModalProps {
  isOpen: boolean;
  matchedKeyword: string;
  cmd: string;
  onResolve: (approved: boolean) => void;
}

export const SafetyConfirmModal: React.FC<SafetyConfirmModalProps> = ({
  isOpen,
  matchedKeyword,
  cmd,
  onResolve,
}) => {
  if (!isOpen) return null;

  return (
    <div className="safety-modal-overlay">
      <div className="safety-modal-content">
        {/* Mock Terminal TitleBar */}
        <div className="safety-modal-titlebar">
          <div className="safety-modal-dots">
            <div className="safety-modal-dot safety-modal-dot-err" />
            <div className="safety-modal-dot safety-modal-dot-warn" />
            <div className="safety-modal-dot safety-modal-dot-succ" />
          </div>
          <div className="safety-modal-title-text">
            pi-cli-guard -- security-core
          </div>
          <div style={{ width: 42 }} /> {/* balance layout */}
        </div>

        {/* Modal Body */}
        <div className="safety-modal-body">
          {/* Warning Header */}
          <div className="safety-modal-header">
            <div className="safety-modal-icon-wrap">
              <AlertTriangle size={20} className="safety-modal-icon" />
            </div>
            <div>
              <div className="safety-modal-title">
                ⚠️ HIGH-RISK COMMAND INTERCEPTED
              </div>
              <div className="safety-modal-subtitle">
                System command execution safety check
              </div>
            </div>
          </div>

          {/* Warning details */}
          <div className="safety-modal-text">
            检测到 AI 尝试在您的宿主机运行可能具有破坏性的指令（触发词：
            <span className="safety-modal-keyword">
              {matchedKeyword}
            </span>
            ）：
          </div>

          {/* Console Code Box */}
          <div className="safety-modal-console">
            {/* Console Header */}
            <div className="safety-modal-console-header">
              <span>SH - INTERACTIVE SESSION</span>
              <span>TIMEOUT: 120s</span>
            </div>
            {/* Code Line */}
            <div className="safety-modal-console-body">
              <span className="safety-modal-console-prompt">$</span>
              <pre className="safety-modal-console-cmd">
                {cmd}
              </pre>
            </div>
          </div>

          {/* Prompt Message */}
          <div className="safety-modal-alert-box">
            请问您是否批准执行此命令？建议对未知指令选择“安全拦截”。
            <div className="safety-modal-shortcut-tip">
              💡 快捷键提示：按 <kbd>A</kbd> 批准执行 · 按 <kbd>B</kbd> / <kbd>Esc</kbd> 拦截操作
            </div>
          </div>

          {/* Actions Button panel */}
          <div className="safety-modal-actions">
            <button
              onClick={() => onResolve(false)}
              className="safety-modal-btn safety-modal-btn-cancel"
            >
              [B] 安全拦截 (Block)
            </button>
            <button
              onClick={() => onResolve(true)}
              className="safety-modal-btn safety-modal-btn-approve"
            >
              [A] 批准执行 (Approve)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SafetyConfirmModal;
