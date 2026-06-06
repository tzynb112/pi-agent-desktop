import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Plus, 
  Trash2, 
  RefreshCw, 
  Download, 
  Upload, 
  ToggleLeft, 
  ToggleRight,
  ExternalLink,
  GitBranch,
  HardDrive,
  Cloud
} from 'lucide-react';
import type { PiPackage, PackageSource } from '../../utils/package-manager';
import { 
  loadInstalledPackages, 
  installPackage, 
  removePackage, 
  togglePackage,
  parsePackageSource,
  formatPackageSource
} from '../../utils/package-manager';

interface PackageManagerProps {
  readSettings: () => Promise<any>;
  writeSettings: (settings: any) => Promise<boolean>;
  executeCommand: (command: string) => Promise<string>;
  deleteDirectory: (path: string) => Promise<boolean>;
  readDir: (path: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }>>;
  readFile: (path: string) => Promise<string | null>;
  onPackagesChange?: (packages: PiPackage[]) => void;
}

const PackageManager: React.FC<PackageManagerProps> = ({
  readSettings,
  writeSettings,
  executeCommand,
  deleteDirectory,
  readDir,
  readFile,
  onPackagesChange,
}) => {
  const [packages, setPackages] = useState<PiPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [showInstallForm, setShowInstallForm] = useState(false);
  const [installInput, setInstallInput] = useState('');
  const [installScope, setInstallScope] = useState<'global' | 'project'>('global');
  const [error, setError] = useState<string | null>(null);

  const loadPackages = async () => {
    setLoading(true);
    try {
      const loaded = await loadInstalledPackages(readSettings);
      setPackages(loaded);
      onPackagesChange?.(loaded);
    } catch (err) {
      console.error('[PackageManager] Failed to load packages:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPackages();
  }, []);

  const handleInstall = async () => {
    if (!installInput.trim()) return;

    setInstalling(true);
    setError(null);

    try {
      const { source, url, version } = parsePackageSource(installInput);
      
      const result = await installPackage(
        { source, url, version, scope: installScope },
        readSettings,
        writeSettings,
        executeCommand
      );

      if (result.success) {
        await loadPackages();
        setShowInstallForm(false);
        setInstallInput('');
      } else {
        setError(result.error || 'Installation failed');
      }
    } catch (err: any) {
      setError(err.message || 'Installation failed');
    } finally {
      setInstalling(false);
    }
  };

  const handleRemove = async (packageId: string) => {
    const pkg = packages.find(p => p.id === packageId);
    if (!pkg) return;

    if (!confirm(`确定要卸载包 "${pkg.name}" 吗？`)) return;

    const result = await removePackage(
      packageId,
      readSettings,
      writeSettings,
      executeCommand,
      deleteDirectory
    );

    if (result.success) {
      await loadPackages();
    } else {
      setError(result.error || 'Removal failed');
    }
  };

  const handleToggle = async (packageId: string) => {
    await togglePackage(packageId, readSettings, writeSettings);
    await loadPackages();
  };

  const getSourceIcon = (source: PackageSource) => {
    switch (source) {
      case 'npm':
        return <Cloud size={14} style={{ color: '#cb3837' }} />;
      case 'git':
        return <GitBranch size={14} style={{ color: '#f05032' }} />;
      case 'local':
        return <HardDrive size={14} style={{ color: 'var(--text-muted)' }} />;
    }
  };

  const getSourceLabel = (source: PackageSource) => {
    switch (source) {
      case 'npm':
        return 'npm';
      case 'git':
        return 'Git';
      case 'local':
        return '本地';
    }
  };

  const renderInstallForm = () => (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        border: '1px solid var(--accent-primary)',
        background: 'var(--bg-elevated)',
        marginBottom: 12,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          包来源
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {(['npm', 'git', 'local'] as PackageSource[]).map(source => (
            <button
              key={source}
              onClick={() => {
                if (source === 'npm' && !installInput.startsWith('npm:')) {
                  setInstallInput('npm:');
                } else if (source === 'git' && !installInput.startsWith('git:')) {
                  setInstallInput('git:');
                }
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {getSourceIcon(source)}
              {getSourceLabel(source)}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={installInput}
          onChange={(e) => setInstallInput(e.target.value)}
          placeholder="npm:@scope/package 或 git:github.com/user/repo 或 /path/to/package"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
          }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          安装范围
        </label>
        <div className="pkg-actions">
          <button
            onClick={() => setInstallScope('global')}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px solid ${installScope === 'global' ? 'var(--accent-primary)' : 'var(--border-default)'}`,
              background: installScope === 'global' ? 'var(--accent-primary)' : 'transparent',
              color: installScope === 'global' ? 'white' : 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            全局 (~/.pi/agent)
          </button>
          <button
            onClick={() => setInstallScope('project')}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px solid ${installScope === 'project' ? 'var(--accent-primary)' : 'var(--border-default)'}`,
              background: installScope === 'project' ? 'var(--accent-primary)' : 'transparent',
              color: installScope === 'project' ? 'white' : 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            项目 (.pi)
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#ef4444',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={() => {
            setShowInstallForm(false);
            setInstallInput('');
            setError(null);
          }}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border-default)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          取消
        </button>
        <button
          onClick={handleInstall}
          disabled={!installInput.trim() || installing}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--accent-primary)',
            color: 'white',
            fontSize: 12,
            cursor: installInput.trim() && !installing ? 'pointer' : 'not-allowed',
            opacity: installInput.trim() && !installing ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {installing ? (
            <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Download size={14} />
          )}
          {installing ? '安装中...' : '安装'}
        </button>
      </div>
    </div>
  );

  const renderPackage = (pkg: PiPackage) => (
    <div
      key={pkg.id}
      style={{
        padding: 14,
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        opacity: pkg.enabled ? 1 : 0.65,
        transition: 'all 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="settings-row">
          <Package size={18} style={{ color: pkg.enabled ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
          <div>
            <div className="pkg-card-name">
              {pkg.name}
              {pkg.version && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                  v{pkg.version}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {getSourceIcon(pkg.source)}
                {getSourceLabel(pkg.source)}
              </span>
              <span>•</span>
              <span>{formatPackageSource(pkg)}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => handleToggle(pkg.id)}
            style={{
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: pkg.enabled ? 'var(--accent-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
            title={pkg.enabled ? '禁用' : '启用'}
          >
            {pkg.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          </button>
          <button
            onClick={() => handleRemove(pkg.id)}
            style={{
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
            title="卸载"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Resource summary */}
      <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {pkg.resources.extensions.length > 0 && (
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
            {pkg.resources.extensions.length} 扩展
          </span>
        )}
        {pkg.resources.skills.length > 0 && (
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
            {pkg.resources.skills.length} 技能
          </span>
        )}
        {pkg.resources.prompts.length > 0 && (
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}>
            {pkg.resources.prompts.length} 模板
          </span>
        )}
        {pkg.resources.themes.length > 0 && (
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(249, 115, 22, 0.1)', color: '#f97316' }}>
            {pkg.resources.themes.length} 主题
          </span>
        )}
      </div>
    </div>
  );

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
            包管理器 (Pi Packages)
          </div>
          <div className="pkg-subtitle">
            安装和管理 pi 包，包含扩展、技能、提示模板和主题。
          </div>
        </div>
        <div className="pkg-actions">
          <button
            onClick={loadPackages}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-default)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={13} />
            刷新
          </button>
          <button
            onClick={() => setShowInstallForm(true)}
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
            安装包
          </button>
        </div>
      </div>

      {showInstallForm && renderInstallForm()}

      <div
        className="scrollbar-thin"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxHeight: '45vh',
          overflowY: 'auto',
          paddingRight: 4,
        }}
      >
        {loading ? (
          <div
            style={{
              padding: '24px 0',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
          >
            加载中...
          </div>
        ) : packages.length === 0 ? (
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
            暂未安装任何包，点击上方按钮安装一个吧
          </div>
        ) : (
          packages.map(renderPackage)
        )}
      </div>

      <div
        style={{
          padding: 12,
          borderRadius: 8,
          background: 'var(--bg-overlay)',
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>💡 包来源说明</div>
        <div>• <strong>npm:</strong> 从 npm 安装，例如 <code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: 3 }}>npm:@pi-community/tools</code></div>
        <div>• <strong>Git:</strong> 从 Git 仓库安装，例如 <code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: 3 }}>git:github.com/user/pi-package</code></div>
        <div>• <strong>本地:</strong> 从本地路径安装，例如 <code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: 3 }}>/path/to/package</code></div>
      </div>
    </div>
  );
};

export default PackageManager;
