import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { ToolCall } from '../../types';
import { ChevronDown, ChevronRight, Wrench, Terminal, Copy, Check } from 'lucide-react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface ToolCallBlockProps {
  toolCall: ToolCall;
}

function hasAnsiCodes(text: string): boolean {
  return /\x1b\[[0-9;]*m/.test(text) || /\x1b\[[\d;]*[A-HJKSTf]/.test(text);
}

function shouldUseXterm(toolCall: ToolCall): boolean {
  if (toolCall.name === 'bash') return true;
  const content = toolCall.result || toolCall.liveOutput || '';
  return hasAnsiCodes(content);
}

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function truncateCommand(args: string, maxLen: number = 60): string {
  try {
    const parsed = JSON.parse(args);
    const cmd = parsed.command || parsed.cmd || args;
    const str = typeof cmd === 'string' ? cmd : JSON.stringify(cmd);
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  } catch {
    return args.length > maxLen ? args.substring(0, maxLen) + '...' : args;
  }
}

const ToolCallBlock: React.FC<ToolCallBlockProps> = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const xtermContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastWrittenLengthRef = useRef(0);

  const useXterm = shouldUseXterm(toolCall);
  const isRunning = toolCall.result === undefined;
  const isError = typeof toolCall.result === 'string' && (toolCall.result.startsWith('Error:') || toolCall.result.includes('error'));

  useEffect(() => {
    if (!expanded || !containerRef.current) return;
    const timer = setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 20) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [expanded]);

  useEffect(() => {
    if (toolCall.result !== undefined) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [toolCall.result]);

  useEffect(() => {
    if (toolCall.result === undefined && toolCall.liveOutput) {
      setExpanded(true);
    }
  }, [toolCall.result, toolCall.liveOutput]);

  useEffect(() => {
    if (!useXterm && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [toolCall.liveOutput, toolCall.result, useXterm]);

  // xterm lifecycle, resizing, and unmounting
  useEffect(() => {
    if (!useXterm || !expanded || !xtermContainerRef.current) return;
    if (xtermRef.current) return;

    const bgBase = getCSSVar('--bg-base') || '#0f0b19';
    const textPrimary = getCSSVar('--text-primary') || '#f0edf6';
    const textMuted = getCSSVar('--text-muted') || '#6b6280';
    const accentPrimary = getCSSVar('--accent-primary') || '#8b5cf6';

    const term = new XTerm({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      fontSize: 12,
      lineHeight: 1.5,
      theme: {
        background: bgBase, foreground: textPrimary, cursor: accentPrimary,
        selectionBackground: `${accentPrimary}40`,
        black: bgBase, red: '#ef4444', green: '#22c55e', yellow: '#f59e0b',
        blue: '#3b82f6', magenta: '#a855f7', cyan: '#06b6d4', white: textPrimary,
        brightBlack: textMuted, brightRed: '#f87171', brightGreen: '#4ade80',
        brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c084fc',
        brightCyan: '#22d3ee', brightWhite: '#ffffff',
      },
      cursorBlink: false, cursorStyle: 'bar', disableStdin: true,
      scrollback: 5000, allowTransparency: true, convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(xtermContainerRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    lastWrittenLengthRef.current = 0;

    const content = toolCall.liveOutput || toolCall.result || '';
    if (content) {
      term.write(content.replace(/\n/g, '\r\n'));
      lastWrittenLengthRef.current = content.length;
    }

    let rafId: number;
    const triggerFit = () => {
      if (
        xtermContainerRef.current &&
        xtermContainerRef.current.clientWidth > 0 &&
        xtermContainerRef.current.clientHeight > 0 &&
        xtermRef.current &&
        !xtermRef.current.element?.classList.contains('xterm-closed')
      ) {
        try {
          fitAddon.fit();
        } catch (err) {
          console.warn('xterm block fit failed:', err);
        }
      }
    };

    rafId = requestAnimationFrame(triggerFit);

    const handleResize = () => {
      triggerFit();
    };
    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => {
      triggerFit();
    });
    observer.observe(xtermContainerRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      lastWrittenLengthRef.current = 0;
    };
  }, [useXterm, expanded]);

  // Write incremental content to xterm
  useEffect(() => {
    if (!useXterm || !xtermRef.current) return;
    const content = toolCall.liveOutput || toolCall.result || '';
    if (content.length > lastWrittenLengthRef.current) {
      const newPart = content.substring(lastWrittenLengthRef.current);
      xtermRef.current.write(newPart.replace(/\n/g, '\r\n'));
      lastWrittenLengthRef.current = content.length;
    }
  }, [toolCall.liveOutput, toolCall.result, useXterm]);

  const getStatusClass = () => {
    if (isRunning) return 'status-pulse status-pulse--running';
    if (isError) return 'status-pulse status-pulse--error';
    return 'status-pulse status-pulse--success';
  };

  const getStatusText = () => {
    if (isRunning) return '运行中';
    if (isError) return '失败';
    return '已完成';
  };

  const getBorderColor = () => {
    if (isError) return 'var(--status-error)';
    return 'var(--status-success)';
  };

  return (
    <div ref={containerRef} className="tool-block-container">
      {/* Collapsed header */}
      <button
        className={'tool-block-header' + (expanded ? ' tool-block-header--expanded' : '')}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={getStatusClass()} />

        {toolCall.name === 'bash'
          ? <Terminal size={13} className="tool-block-header-icon-svg" />
          : <Wrench size={13} className="tool-block-header-icon-svg" />
        }

        <span className="tool-block-header-name">{toolCall.name}</span>

        {toolCall.name === 'bash' && !expanded && (
          <span className="tool-block-header-args">
            {truncateCommand(toolCall.arguments)}
          </span>
        )}

        <span className="tool-block-header-status">
          <span className="tool-block-header-status-text">{getStatusText()}</span>
          {isRunning && elapsed > 0 && (
            <span className="tool-block-header-elapsed">{elapsed}s</span>
          )}
          {expanded
            ? <ChevronDown size={12} className="tool-block-header-chevron" />
            : <ChevronRight size={12} className="tool-block-header-chevron" />
          }
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div
          className={
            'tool-block-expanded ' +
            (isError ? 'tool-block-expanded--error' : isRunning ? 'tool-block-expanded--running' : 'tool-block-expanded--success')
          }
        >
          {/* Arguments */}
          <div className="tool-block-section">
            <div className="tool-block-section-title">参数</div>
            <pre className="tool-block-args-content scrollbar-thin">
              {toolCall.arguments || '{}'}
            </pre>
          </div>

          {/* Result */}
          {(toolCall.result !== undefined || toolCall.liveOutput) && (
            <div className="tool-block-result-section">
              <div className="tool-block-result-header">
                <div className="tool-block-result-header-left">
                  <Terminal size={10} />
                  {isRunning ? '实时输出' : '结果'}
                </div>
                {toolCall.result && (
                  <button
                    className={'tool-action-btn' + (copied ? ' tool-action-btn--copied' : '')}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(toolCall.result || '');
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    title="复制结果"
                  >
                    {copied ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                )}
              </div>

              {useXterm ? (
                <div ref={xtermContainerRef} className="tool-block-xterm" />
              ) : (
                <pre
                  ref={preRef}
                  className={'scrollbar-thin tool-block-result-content ' + (isError ? 'tool-block-result-content--error' : 'tool-block-result-content--normal')}
                >
                  {toolCall.result !== undefined ? toolCall.result : toolCall.liveOutput}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default memo(ToolCallBlock, (prev, next) => {
  return (
    prev.toolCall.result === next.toolCall.result &&
    prev.toolCall.liveOutput === next.toolCall.liveOutput
  );
});