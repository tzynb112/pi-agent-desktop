import React from 'react';
import { Plus, Trash2, Globe, Cpu } from 'lucide-react';
import type { McpServerConfig } from '../../../shared/ipc-types';

interface McpConfigProps {
  servers: McpServerConfig[];
  onToggle: (id: string) => void;
  onAddServer: () => void;
  onDeleteServer: (id: string) => void;
  onFieldChange: (id: string, field: 'name' | 'command' | 'args' | 'env', value: string) => void;
}

const McpConfig: React.FC<McpConfigProps> = ({
  servers = [],
  onToggle,
  onAddServer,
  onDeleteServer,
  onFieldChange,
}) => {
  const serializeValue = (value: string | string[] | Record<string, string> | undefined): string => {
    if (Array.isArray(value)) return value.join(' ');
    if (value && typeof value === 'object') {
      return Object.entries(value).map(([key, val]) => `${key}=${val}`).join('\n');
    }
    return value || '';
  };

  return (
    <div className="pkg-container">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: 10,
        }}
      >
        <div>
          <div className="pkg-title">
            跨进程 Stdio MCP 扩展服务配置
          </div>
          <div className="pkg-subtitle">
            通过 Model Context Protocol (MCP) 标准连接外部工具服务，客户端主进程将利用标准输入/输出启动对应的扩展进程并同步加载其提供的工具集。
          </div>
        </div>
        <button
          onClick={onAddServer}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--accent-primary)',
            color: 'white',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
        >
          <Plus size={13} />
          添加扩展
        </button>
      </div>

      <div
        className="scrollbar-thin"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          maxHeight: '45vh',
          overflowY: 'auto',
          paddingRight: 4,
        }}
      >
        {servers.length === 0 ? (
          <div
            style={{
              padding: '24px 0',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 12,
              border: '1px dashed var(--border-subtle)',
              borderRadius: 10,
            }}
          >
            暂无配置的 MCP 扩展服务。添加扩展以扩充大模型工具库。
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.id}
              style={{
                padding: 14,
                borderRadius: 10,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)',
                opacity: server.enabled ? 1 : 0.65,
                transition: 'all 0.2s',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 10,
                }}
              >
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: 'var(--bg-overlay)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent-primary)',
                    }}
                  >
                    <Cpu size={14} />
                  </div>
                  <input
                    type="text"
                    value={server.name}
                    onChange={(e) => onFieldChange(server.id, 'name', e.target.value)}
                    placeholder="服务名称 (如: github-tools)"
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-base)',
                      color: 'var(--text-primary)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      outline: 'none',
                      width: '60%',
                    }}
                  />
                </div>
                <div className="settings-row">
                  {/* Enable switch */}
                  <button
                    onClick={() => onToggle(server.id)}
                    style={{
                      width: 32,
                      height: 18,
                      borderRadius: 9,
                      border: 'none',
                      background: server.enabled ? 'var(--accent-primary)' : 'var(--bg-overlay)',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'all 0.2s',
                    }}
                    title={server.enabled ? '已启用' : '已禁用'}
                  >
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: 'white',
                        position: 'absolute',
                        top: 2,
                        left: server.enabled ? 16 : 2,
                        transition: 'all 0.2s',
                      }}
                    />
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={() => onDeleteServer(server.id)}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      border: 'none',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: 'var(--status-error)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)')}
                    title="删除扩展"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Stdio command and args inputs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <div className="pkg-actions">
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
                      启动命令 (Command)
                    </label>
                    <input
                      type="text"
                      value={server.command}
                      onChange={(e) => onFieldChange(server.id, 'command', e.target.value)}
                      placeholder="如: node, python, npx"
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-base)',
                        color: 'var(--text-secondary)',
                        fontSize: 11.5,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ flex: 2 }}>
                    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
                      参数 (Arguments)
                    </label>
                    <input
                      type="text"
                      value={serializeValue(server.args)}
                      onChange={(e) => onFieldChange(server.id, 'args', e.target.value)}
                      placeholder="如: D:\tools\index.js  或者  -y @modelcontextprotocol/server-postgres"
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-base)',
                        color: 'var(--text-secondary)',
                        fontSize: 11.5,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>

                {/* Env Textarea */}
                <div>
                  <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
                    环境变量 (Environment variables, 格式如: KEY=VALUE，每行一个)
                  </label>
                  <textarea
                    value={serializeValue(server.env)}
                    onChange={(e) => onFieldChange(server.id, 'env', e.target.value)}
                    placeholder="GITHUB_TOKEN=your_token_here&#10;PORT=8080"
                    rows={2}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-base)',
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      outline: 'none',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default McpConfig;
export type { McpServerConfig };
