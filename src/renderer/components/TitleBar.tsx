import React, { memo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Moon, Sun, Settings } from 'lucide-react';

interface TitleBarProps {
  onSettingsClick?: () => void;
  agentName?: string;
  modelName?: string;
  gitBranch?: string;
  projectName?: string;
}

const TitleBar: React.FC<TitleBarProps> = ({ onSettingsClick, agentName, modelName, gitBranch, projectName }) => {
  const { theme, toggleTheme } = useTheme();
  const handleMinimize = () => window.electronAPI?.minimizeWindow();
  const handleMaximize = () => window.electronAPI?.maximizeWindow();
  const handleClose = () => window.electronAPI?.closeWindow();

  return (
    <div className="titlebar glass">
      <div className="titlebar-left">
        <div className="titlebar-brand">
          <div className="titlebar-logo logo-glow">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 20V4h6.5a4.5 4.5 0 0 1 0 9H8" />
            </svg>
          </div>
          <div className="titlebar-info">
            <span className="titlebar-name">{agentName || 'PianoAgent'}</span>
            <div className="titlebar-meta">
              {projectName && <span className="titlebar-project">{projectName}</span>}
              {gitBranch && <span className="titlebar-branch">{'\u2E26'}{gitBranch}</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="titlebar-right">
        <button className="titlebar-btn" onClick={onSettingsClick} title="模型配置">
          <Settings size={14} />
        </button>
        <button className="titlebar-btn" onClick={toggleTheme} title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button className="titlebar-btn titlebar-btn--wide" onClick={handleMinimize}>
          <svg width="10" height="1" viewBox="0 0 10 1"><rect fill="currentColor" width="10" height="1" rx="0.5" /></svg>
        </button>
        <button className="titlebar-btn titlebar-btn--wide" onClick={handleMaximize}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect fill="none" stroke="currentColor" strokeWidth="1" x="0.5" y="0.5" width="9" height="9" rx="1" /></svg>
        </button>
        <button className="titlebar-btn titlebar-btn--wide titlebar-btn--close" onClick={handleClose}>
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
};

export default memo(TitleBar);