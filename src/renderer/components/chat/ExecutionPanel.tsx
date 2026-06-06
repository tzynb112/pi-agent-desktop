/**
 * ExecutionPanel - Real-time execution preview panel.
 * Pi CLI polish: All UI chrome uses CSS variables via globals.css exec-* classes.
 * xterm ANSI colors remain hardcoded (terminal palette, not UI chrome).
 */

import React, { useState, useEffect, useRef, memo } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { X, Maximize2, Minimize2, Terminal as TerminalIcon, FileCode, ChevronDown, ChevronRight } from 'lucide-react';

import { safeStorage } from '../../utils/storage';

interface ExecutionPanelProps {
  isVisible: boolean;
  onClose: () => void;
  toolCalls?: Array<{ id: string; name: string; arguments: string; result?: string; liveOutput?: string; }>;
  currentGoal?: { description: string; status: string; subTasks: Array<{ id: string; description: string; status: string; currentTool?: { name: string; target: string }; }>; } | null;
}

const ExecutionPanel: React.FC<ExecutionPanelProps> = ({
  isVisible,
  onClose,
  toolCalls = [],
  currentGoal,
}) => {
  const [activeTab, setActiveTab] = useState<'terminal' | 'changes'>('terminal');
  const [isMaximized, setIsMaximized] = useState(false);
  
  // Custom resizability state
  const [height, setHeight] = useState(() => {
    const saved = safeStorage.getItem('piano-exec-panel-height');
    return saved ? parseInt(saved, 10) : 240;
  });
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = height;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(120, Math.min(window.innerHeight * 0.8, startHeight - deltaY));
      setHeight(newHeight);
      safeStorage.setItem('piano-exec-panel-height', newHeight.toString());
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  };

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastWrittenRef = useRef(0);

  useEffect(() => {
    if (!isVisible || !terminalRef.current) return;
    if (xtermRef.current) return;

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      fontSize: 12, lineHeight: 1.4,
      theme: {
        background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff',
        selectionBackground: '#264f78', black: '#484f58', red: '#ff7b72',
        green: '#3fb950', yellow: '#d29922', blue: '#58a6ff',
        magenta: '#bc8cff', cyan: '#39d353', white: '#c9d1d9',
        brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
        brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
        brightCyan: '#56d364', brightWhite: '#f0f6fc',
      },
      cursorBlink: false, disableStdin: true, scrollback: 3000, convertEol: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    lastWrittenRef.current = 0;

    let rafId: number;
    const triggerFit = () => {
      if (
        terminalRef.current &&
        terminalRef.current.clientWidth > 0 &&
        terminalRef.current.clientHeight > 0 &&
        xtermRef.current &&
        !xtermRef.current.element?.classList.contains('xterm-closed')
      ) {
        try {
          fitAddon.fit();
        } catch (err) {
          console.warn('xterm fit failed:', err);
        }
      }
    };

    rafId = requestAnimationFrame(triggerFit);

    const observer = new ResizeObserver(() => {
      triggerFit();
    });
    observer.observe(terminalRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      lastWrittenRef.current = 0;
    };
  }, [isVisible]);

  useEffect(() => {
    if (!xtermRef.current) return;
    const term = xtermRef.current;
    const latestTool = toolCalls[toolCalls.length - 1];
    if (!latestTool) return;
    const output = latestTool.liveOutput || latestTool.result || '';
    const newContent = output.substring(lastWrittenRef.current);
    if (newContent) {
      if (lastWrittenRef.current === 0) {
        term.write('\r\n\x1b[1;36m> ' + latestTool.name + '\x1b[0m\r\n');
        if (latestTool.arguments) {
          try {
            const args = JSON.parse(latestTool.arguments);
            const summary = args.command || args.file_path || '';
            if (summary) { term.write('\x1b[90m  ' + summary.substring(0, 80) + '\x1b[0m\r\n\r\n'); }
          } catch {}
        }
      }
      term.write(newContent.replace(/\n/g, '\r\n'));
      lastWrittenRef.current = output.length;
    }
    if (latestTool.id !== (toolCalls as any).__lastId) {
      (toolCalls as any).__lastId = latestTool.id;
      lastWrittenRef.current = 0;
    }
  }, [toolCalls]);

  const fileChanges = toolCalls
    .filter(tc => tc.name === 'write' || tc.name === 'edit')
    .map(tc => {
      try {
        const args = JSON.parse(tc.arguments);
        return { file: args.file_path || '', action: tc.name === 'write' ? 'created' : 'modified', content: args.content, oldStr: args.old_str, newStr: args.new_str };
      } catch { return null; }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (!isVisible) return null;

  const tabClass = (tab: string) =>
    `exec-panel-tab${activeTab === tab ? ' exec-panel-tab--active' : ''}`;

  return (
    <div
      className="exec-panel"
      style={{
        height: isMaximized ? '100%' : height,
        position: 'relative',
        transition: isResizing ? 'none' : 'height var(--transition-fast)',
      }}
    >
      {!isMaximized && (
        <div
          onMouseDown={handleResizeMouseDown}
          style={{
            height: 4,
            cursor: 'ns-resize',
            background: 'var(--border-subtle)',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-primary)';
          }}
          onMouseLeave={(e) => {
            if (!isResizing) {
              e.currentTarget.style.background = 'var(--border-subtle)';
            }
          }}
        />
      )}
      <div className="exec-panel-header" style={{ position: 'relative', zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setActiveTab('terminal')} className={tabClass('terminal')}>
            <TerminalIcon size={12} />
            终端
          </button>
          <button onClick={() => setActiveTab('changes')} className={tabClass('changes')}>
            <FileCode size={12} />
            变更 ({fileChanges.length})
          </button>
          {currentGoal && (
            <span className="exec-status-text">
              {currentGoal.status === 'executing' ? '⏳' : '✅'} {currentGoal.description.substring(0, 40)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => setIsMaximized(!isMaximized)} className="exec-panel-btn">
            {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button onClick={onClose} className="exec-panel-btn"><X size={12} /></button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'terminal' ? (
          <div ref={terminalRef} style={{ width: '100%', height: '100%', padding: '4px 0' }} />
        ) : (
          <div style={{ height: '100%', overflow: 'auto', padding: 12 }}>
            {fileChanges.length === 0 ? (
              <div className="exec-empty">暂无文件变更</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {fileChanges.map((change, idx) => (
                  <FileChangeCard key={idx} change={change} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const FileChangeCard: React.FC<{
  change: { file: string; action: string; content?: string; oldStr?: string; newStr?: string };
}> = memo(({ change }) => {
  const [expanded, setExpanded] = useState(false);
  const fileName = change.file.split(/[\/\\]/).pop() || change.file;

  return (
    <div className="exec-change-card">
      <div onClick={() => setExpanded(!expanded)} className="exec-change-header">
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={`exec-change-badge${change.action === 'created' ? ' exec-change-badge--new' : ' exec-change-badge--mod'}`}>
          {change.action === 'created' ? 'NEW' : 'MOD'}
        </span>
        <span className="exec-change-filename">{fileName}</span>
        <span className="exec-change-path">{change.file}</span>
      </div>
      {expanded && (
        <div className="exec-diff">
          {change.action === 'created' && change.content && (
            <pre>
              {change.content.split('\n').map((line, i) => (
                <div key={i} className="exec-diff-add">
                  <span className="exec-diff-marker">+</span>{line}
                </div>
              ))}
            </pre>
          )}
          {change.action === 'modified' && (
            <pre>
              {change.oldStr?.split('\n').map((line, i) => (
                <div key={`old-${i}`} className="exec-diff-del">
                  <span className="exec-diff-marker">-</span>{line}
                </div>
              ))}
              {change.newStr?.split('\n').map((line, i) => (
                <div key={`new-${i}`} className="exec-diff-add">
                  <span className="exec-diff-marker">+</span>{line}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});

export default ExecutionPanel;
