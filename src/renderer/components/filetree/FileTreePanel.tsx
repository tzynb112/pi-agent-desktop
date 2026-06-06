import React, { useState, useEffect } from 'react';
import { FileEntry } from '../../types';
import { FolderOpen, ChevronRight, ChevronDown, File, FileCode, FileJson, FileText, PanelRightClose, RefreshCw } from 'lucide-react';

interface FileTreePanelProps {
  rootPath: string | null;
  onOpenFolder: () => void;
  onFileOpen: (filePath: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width?: number;
}

const getFileIcon = (name: string): React.ReactNode => {
  const ext = name.split('.').pop()?.toLowerCase();
  const size = 14;
  const colorMap: Record<string, string> = {
    ts: '#3178c6',
    tsx: '#3178c6',
    js: '#f7df1e',
    jsx: '#f7df1e',
    json: '#f59e0b',
    css: '#06b6d4',
    html: '#f97316',
    md: '#8b5cf6',
    py: '#3b82f6',
    rs: '#f43f5e',
    go: '#06b6d4',
    java: '#ef4444',
    vue: '#10b981',
    svelte: '#f97316',
  };
  const color = colorMap[ext || ''] || 'var(--text-muted)';

  if (['json'].includes(ext || '')) return <FileJson size={size} style={{ color }} />;
  if (['md'].includes(ext || '')) return <FileText size={size} style={{ color }} />;
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'vue', 'svelte'].includes(ext || ''))
    return <FileCode size={size} style={{ color }} />;
  return <File size={size} style={{ color }} />;
};

const FileTreeItem: React.FC<{
  entry: FileEntry;
  depth: number;
  onFileOpen: (path: string) => void;
}> = ({ entry, depth, onFileOpen }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>(entry.children || []);

  const toggle = async () => {
    if (entry.isDirectory) {
      if (!expanded && children.length === 0 && window.electronAPI) {
        const items = await window.electronAPI.readDirectory(entry.path);
        setChildren(
          items.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
        );
      }
      setExpanded(!expanded);
    } else {
      onFileOpen(entry.path);
    }
  };

  return (
    <div>
      <div
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 28,
          paddingLeft: depth * 14 + 10,
          paddingRight: 10,
          cursor: 'pointer',
          fontSize: 12.5,
          color: 'var(--text-secondary)',
          transition: 'all 0.1s',
          borderRadius: 4,
          margin: '1px 4px',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hover)';
          e.currentTarget.style.color = 'var(--text-primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }}
      >
        {entry.isDirectory ? (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 16,
              flexShrink: 0,
              transition: 'transform 0.15s',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            <ChevronRight size={12} />
          </span>
        ) : (
          <span style={{ width: 16, flexShrink: 0 }} />
        )}
        <span style={{ marginRight: 6, display: 'flex', alignItems: 'center' }}>
          {entry.isDirectory ? (
            <FolderOpen
              size={14}
              style={{
                color: expanded ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}
            />
          ) : (
            getFileIcon(entry.name)
          )}
        </span>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.name}
        </span>
      </div>
      {expanded &&
        children.map((child) => (
          <FileTreeItem
            key={child.path}
            entry={child}
            depth={depth + 1}
            onFileOpen={onFileOpen}
          />
        ))}
    </div>
  );
};

const FileTreePanel: React.FC<FileTreePanelProps> = ({
  rootPath,
  onOpenFolder,
  onFileOpen,
  collapsed,
  onToggleCollapse,
  width = 260,
}) => {
  const [entries, setEntries] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (rootPath && window.electronAPI) {
      window.electronAPI.readDirectory(rootPath).then((items) => {
        setEntries(
          items.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
        );
      });
    }
  }, [rootPath]);

  if (collapsed) {
    return null;
  }

  return (
    <div
      className="animate-slide-left"
      style={{
        width: width,
        minWidth: width,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            文件浏览
          </span>
          {rootPath && (
            <button
              onClick={() => {
                if (rootPath && window.electronAPI) {
                  window.electronAPI.readDirectory(rootPath).then((items) => {
                    setEntries(items.sort((a, b) => {
                      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                      return a.name.localeCompare(b.name);
                    }));
                  });
                }
              }}
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
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--accent-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
              title="刷新文件树"
            >
              <RefreshCw size={11} />
            </button>
          )}
        </div>
        <button
          onClick={onToggleCollapse}
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            border: 'none',
            background: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
          title="关闭文件树"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {rootPath ? (
        <>
          <div
            style={{
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--text-muted)',
              background: 'var(--bg-overlay)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <FolderOpen size={12} style={{ color: 'var(--accent-primary)' }} />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {rootPath.split(/[\\/]/).pop()}
            </span>
          </div>
          <div
            className="scrollbar-thin"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '6px 0',
            }}
          >
            {entries.map((entry) => (
              <FileTreeItem
                key={entry.path}
                entry={entry}
                depth={0}
                onFileOpen={onFileOpen}
              />
            ))}
          </div>
        </>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            gap: 12,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'var(--bg-overlay)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FolderOpen size={22} style={{ color: 'var(--text-muted)' }} />
          </div>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            还没有打开文件夹
          </p>
          <button
            onClick={onOpenFolder}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
              e.currentTarget.style.color = 'var(--accent-primary)';
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-default)';
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.background = 'var(--bg-elevated)';
            }}
          >
            打开文件夹
          </button>
        </div>
      )}
    </div>
  );
};

export default FileTreePanel;
