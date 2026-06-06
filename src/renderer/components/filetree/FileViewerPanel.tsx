import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, Check, FileText, WrapText, AlignLeft, Search } from 'lucide-react';

interface FileViewerPanelProps {
  filePath: string | null;
  content: string | null;
  onClose: () => void;
  width?: number;
}

const FileViewerPanel: React.FC<FileViewerPanelProps> = ({ filePath, content, onClose, width }) => {
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSearch) {
          setShowSearch(false);
          setSearchQuery('');
        } else {
          onClose();
        }
      }
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showSearch]);

  const fileName = filePath?.split(/[/\\]/).pop() || '';
  const lines = content ? content.split('\n') : [];

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        width: width || 480,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border-strong)',
        zIndex: 10,
        position: 'relative',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, overflow: 'hidden', flex: 1, minWidth: 0 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: 'var(--bg-overlay)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-primary)',
              flexShrink: 0,
            }}
          >
            <FileText size={14} />
          </div>
          <div style={{ overflow: 'hidden', minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}
            >
              {fileName}
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                fontFamily: 'var(--font-mono)',
              }}
              title={filePath || ''}
            >
              {filePath}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
          {/* Word wrap toggle */}
          <button
            onClick={() => setWrapLines(!wrapLines)}
            title={wrapLines ? '关闭自动换行' : '开启自动换行'}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: wrapLines ? 'var(--bg-active)' : 'transparent',
              color: wrapLines ? 'var(--accent-secondary)' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            {wrapLines ? <AlignLeft size={13} /> : <WrapText size={13} />}
          </button>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            disabled={!content}
            title="复制全部内容"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: copied ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
              color: copied ? 'var(--status-success)' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>

          {/* Close button */}
          <button
            onClick={onClose}
            title="关闭 (Esc)"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
              e.currentTarget.style.color = 'var(--status-error)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Line count badge */}
      {content !== null && content.trim() !== '' && (
        <div
          style={{
            padding: '5px 14px',
            background: 'var(--bg-base)',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: 10.5,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <span>{lines.length} 行</span>
          <span>{content.length} 字符</span>
          <button
            onClick={() => {
              setShowSearch(!showSearch);
              if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            style={{
              marginLeft: 'auto',
              width: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              border: 'none',
              background: showSearch ? 'var(--bg-active)' : 'none',
              color: showSearch ? 'var(--accent-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            title="搜索 (Ctrl+F)"
          >
            <Search size={11} />
          </button>
        </div>
      )}

      {/* Search bar */}
      {showSearch && content && (
        <div
          style={{
            padding: '6px 14px',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索文件内容..."
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 12,
              outline: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          />
          {searchQuery && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
              {lines.filter(l => l.toLowerCase().includes(searchQuery.toLowerCase())).length} 个匹配
            </span>
          )}
          <button
            onClick={() => { setShowSearch(false); setSearchQuery(''); }}
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              border: 'none',
              background: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Content body */}
      <div
        className="scrollbar-thin"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          background: 'var(--bg-base)',
          display: 'flex',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: '20px',
        }}
      >
        {content === null ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <span style={{ opacity: 0.6 }}>正在加载文件内容...</span>
          </div>
        ) : content.trim() === '' ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            空文件
          </div>
        ) : (
          <>
            {/* Line Numbers */}
            <div
              style={{
                minWidth: 42,
                paddingTop: 12,
                paddingBottom: 12,
                paddingRight: 10,
                textAlign: 'right',
                color: 'rgba(108,99,128,0.55)',
                userSelect: 'none',
                borderRight: '1px solid var(--border-subtle)',
                background: 'var(--bg-base)',
                flexShrink: 0,
                fontSize: 11,
              }}
            >
              {lines.map((_, i) => (
                <div key={i} style={{ height: 20, paddingRight: 2 }}>
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Code lines */}
            <div
              style={{
                flex: 1,
                paddingTop: 12,
                paddingBottom: 12,
                paddingLeft: 14,
                paddingRight: 16,
                color: 'var(--text-primary)',
                overflowX: wrapLines ? 'hidden' : 'auto',
                whiteSpace: wrapLines ? 'pre-wrap' : 'pre',
                wordBreak: wrapLines ? 'break-all' : 'normal',
              }}
            >
              {lines.map((line, i) => {
                if (!searchQuery || !line.toLowerCase().includes(searchQuery.toLowerCase())) {
                  return <div key={i} style={{ height: 20 }}>{line || ' '}</div>;
                }
                const idx = line.toLowerCase().indexOf(searchQuery.toLowerCase());
                const before = line.substring(0, idx);
                const match = line.substring(idx, idx + searchQuery.length);
                const after = line.substring(idx + searchQuery.length);
                return (
                  <div key={i} style={{ height: 20, background: 'rgba(251, 191, 36, 0.1)' }}>
                    {before}
                    <mark style={{ background: 'rgba(251, 191, 36, 0.4)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>{match}</mark>
                    {after}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default FileViewerPanel;
