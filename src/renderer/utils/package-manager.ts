/**
 * Pi Packages Manager
 * Manages installation, removal, and discovery of pi packages
 */

export type PackageSource = 'npm' | 'git' | 'local';

export interface PiPackage {
  id: string;
  name: string;
  source: PackageSource;
  url: string;
  version?: string;
  description?: string;
  installedAt: number;
  enabled: boolean;
  resources: {
    extensions: string[];
    skills: string[];
    prompts: string[];
    themes: string[];
  };
  metadata?: {
    video?: string;
    image?: string;
    keywords?: string[];
  };
}

export interface PackageInstallOptions {
  source: PackageSource;
  url: string;
  version?: string;
  scope?: 'global' | 'project';
}

const NPM_PACKAGE_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const PACKAGE_VERSION_RE = /^[a-z0-9._~:+-]+$/i;
const GIT_URL_RE = /^(?:https?:\/\/|ssh:\/\/|git@)[^\s"'`;&|<>]+$/i;

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function assertSafeVersion(version?: string): void {
  if (version && !PACKAGE_VERSION_RE.test(version)) {
    throw new Error(`Invalid package version or ref: ${version}`);
  }
}

function assertSafeNpmPackage(name: string, version?: string): void {
  if (!NPM_PACKAGE_RE.test(name)) {
    throw new Error(`Invalid npm package name: ${name}`);
  }
  assertSafeVersion(version);
}

function assertSafeGitUrl(url: string, version?: string): void {
  if (!GIT_URL_RE.test(url)) {
    throw new Error(`Invalid git URL: ${url}`);
  }
  assertSafeVersion(version);
}

/**
 * Parse package source string (e.g., "npm:@foo/bar@1.0.0", "git:github.com/user/repo@v1")
 */
export function parsePackageSource(sourceStr: string): { source: PackageSource; url: string; version?: string } {
  if (sourceStr.startsWith('npm:')) {
    const spec = sourceStr.substring(4);
    const atIndex = spec.lastIndexOf('@');
    if (atIndex > 0) {
      return {
        source: 'npm',
        url: spec.substring(0, atIndex),
        version: spec.substring(atIndex + 1),
      };
    }
    return { source: 'npm', url: spec };
  }

  if (sourceStr.startsWith('git:')) {
    const spec = sourceStr.substring(4);
    const atIndex = spec.lastIndexOf('@');
    if (atIndex > 0) {
      return {
        source: 'git',
        url: spec.substring(0, atIndex),
        version: spec.substring(atIndex + 1),
      };
    }
    return { source: 'git', url: spec };
  }

  if (sourceStr.startsWith('https://') || sourceStr.startsWith('http://') || sourceStr.startsWith('ssh://')) {
    const atIndex = sourceStr.lastIndexOf('@');
    if (atIndex > 0) {
      return {
        source: 'git',
        url: sourceStr.substring(0, atIndex),
        version: sourceStr.substring(atIndex + 1),
      };
    }
    return { source: 'git', url: sourceStr };
  }

  // Local path
  return { source: 'local', url: sourceStr };
}

/**
 * Format package source string for display
 */
export function formatPackageSource(pkg: PiPackage): string {
  switch (pkg.source) {
    case 'npm':
      return pkg.version ? `npm:${pkg.name}@${pkg.version}` : `npm:${pkg.name}`;
    case 'git':
      return pkg.version ? `git:${pkg.url}@${pkg.version}` : `git:${pkg.url}`;
    case 'local':
      return pkg.url;
    default:
      return pkg.name;
  }
}

/**
 * Load installed packages from settings
 */
export async function loadInstalledPackages(
  readSettings: () => Promise<any>
): Promise<PiPackage[]> {
  try {
    const settings = await readSettings();
    return settings.packages || [];
  } catch (err) {
    console.error('[PackageManager] Failed to load packages:', err);
    return [];
  }
}

/**
 * Save packages to settings
 */
export async function savePackages(
  packages: PiPackage[],
  readSettings: () => Promise<any>,
  writeSettings: (settings: any) => Promise<boolean>
): Promise<boolean> {
  try {
    const settings = await readSettings();
    settings.packages = packages;
    return writeSettings(settings);
  } catch (err) {
    console.error('[PackageManager] Failed to save packages:', err);
    return false;
  }
}

/**
 * Install a package
 */
export async function installPackage(
  options: PackageInstallOptions,
  readSettings: () => Promise<any>,
  writeSettings: (settings: any) => Promise<boolean>,
  executeCommand: (command: string) => Promise<string>
): Promise<{ success: boolean; error?: string }> {
  const { source, url, version, scope = 'global' } = options;
  
  try {
    // Check if already installed
    const packages = await loadInstalledPackages(readSettings);
    const existing = packages.find(p => p.url === url && p.source === source);
    if (existing) {
      return { success: false, error: 'Package already installed' };
    }

    // Execute install command
    let installCmd = '';
    const baseDir = scope === 'global' 
      ? 'C:\\Users\\Administrator\\.pi\\agent' 
      : '.pi';

    switch (source) {
      case 'npm':
        assertSafeNpmPackage(url, version);
        installCmd = [
          `New-Item -ItemType Directory -Force -Path ${quotePowerShell(`${baseDir}\\npm`)} | Out-Null`,
          `Set-Location -LiteralPath ${quotePowerShell(`${baseDir}\\npm`)}`,
          `npm install ${quotePowerShell(`${url}${version ? `@${version}` : ''}`)}`,
        ].join('; ');
        break;
      case 'git':
        assertSafeGitUrl(url, version);
        installCmd = [
          `New-Item -ItemType Directory -Force -Path ${quotePowerShell(`${baseDir}\\git`)} | Out-Null`,
          `git clone ${quotePowerShell(url)} ${quotePowerShell(`${baseDir}\\git\\${url.replace(/[^a-zA-Z0-9]/g, '_')}`)}`,
        ].join('; ');
        if (version) {
          installCmd += `; Set-Location -LiteralPath ${quotePowerShell(`${baseDir}\\git\\${url.replace(/[^a-zA-Z0-9]/g, '_')}`)}; git checkout ${quotePowerShell(version)}`;
        }
        break;
      case 'local':
        // Local paths don't need installation
        break;
    }

    if (installCmd) {
      const result = await executeCommand(installCmd);
      if (result.startsWith('Error:')) {
        return { success: false, error: result };
      }
    }

    // Create package entry
    const newPackage: PiPackage = {
      id: `pkg_${Date.now()}`,
      name: url.split('/').pop()?.replace('.git', '') || url,
      source,
      url: url,
      version,
      installedAt: Date.now(),
      enabled: true,
      resources: {
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      },
    };

    // Save to settings
    packages.push(newPackage);
    await savePackages(packages, readSettings, writeSettings);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Installation failed' };
  }
}

/**
 * Remove a package
 */
export async function removePackage(
  packageId: string,
  readSettings: () => Promise<any>,
  writeSettings: (settings: any) => Promise<boolean>,
  executeCommand: (command: string) => Promise<string>,
  deleteDirectory: (path: string) => Promise<boolean>
): Promise<{ success: boolean; error?: string }> {
  try {
    const packages = await loadInstalledPackages(readSettings);
    const pkg = packages.find(p => p.id === packageId);
    
    if (!pkg) {
      return { success: false, error: 'Package not found' };
    }

    // Remove files based on source
    const baseDir = 'C:\\Users\\Administrator\\.pi\\agent';
    
    switch (pkg.source) {
      case 'npm':
        assertSafeNpmPackage(pkg.name);
        await executeCommand(`Set-Location -LiteralPath ${quotePowerShell(`${baseDir}\\npm`)}; npm uninstall ${quotePowerShell(pkg.name)}`);
        break;
      case 'git':
        const gitDir = `${baseDir}\\git\\${pkg.url.replace(/[^a-zA-Z0-9]/g, '_')}`;
        await deleteDirectory(gitDir);
        break;
      case 'local':
        // Local paths are not deleted
        break;
    }

    // Remove from settings
    const updatedPackages = packages.filter(p => p.id !== packageId);
    await savePackages(updatedPackages, readSettings, writeSettings);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Removal failed' };
  }
}

/**
 * Toggle package enabled state
 */
export async function togglePackage(
  packageId: string,
  readSettings: () => Promise<any>,
  writeSettings: (settings: any) => Promise<boolean>
): Promise<boolean> {
  try {
    const packages = await loadInstalledPackages(readSettings);
    const pkg = packages.find(p => p.id === packageId);
    
    if (!pkg) {
      return false;
    }

    pkg.enabled = !pkg.enabled;
    await savePackages(packages, readSettings, writeSettings);
    return true;
  } catch (err) {
    console.error('[PackageManager] Failed to toggle package:', err);
    return false;
  }
}

/**
 * Discover package resources
 */
export async function discoverPackageResources(
  pkg: PiPackage,
  readDir: (path: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }>>,
  readFile: (path: string) => Promise<string | null>
): Promise<PiPackage> {
  const baseDir = 'C:\\Users\\Administrator\\.pi\\agent';
  let packageDir = '';

  switch (pkg.source) {
    case 'npm':
      packageDir = `${baseDir}\\npm\\node_modules\\${pkg.name}`;
      break;
    case 'git':
      packageDir = `${baseDir}\\git\\${pkg.url.replace(/[^a-zA-Z0-9]/g, '_')}`;
      break;
    case 'local':
      packageDir = pkg.url;
      break;
  }

  try {
    // Read package.json for pi manifest
    const packageJsonPath = `${packageDir}\\package.json`;
    const packageJsonContent = await readFile(packageJsonPath);
    
    if (packageJsonContent) {
      const packageJson = JSON.parse(packageJsonContent);
      const piManifest = packageJson.pi;

      if (piManifest) {
        // Load resources from manifest
        for (const type of ['extensions', 'skills', 'prompts', 'themes'] as const) {
          const paths = piManifest[type] || [];
          for (const resourcePath of paths) {
            const fullPath = `${packageDir}\\${resourcePath}`;
            const entries = await readDir(fullPath);
            for (const entry of entries) {
              pkg.resources[type].push(entry.path);
            }
          }
        }
      } else {
        // Auto-discover from conventional directories
        for (const type of ['extensions', 'skills', 'prompts', 'themes'] as const) {
          const dirPath = `${packageDir}\\${type}`;
          try {
            const entries = await readDir(dirPath);
            for (const entry of entries) {
              pkg.resources[type].push(entry.path);
            }
          } catch {
            // Directory might not exist
          }
        }
      }
    }
  } catch (err) {
    console.error(`[PackageManager] Failed to discover resources for ${pkg.name}:`, err);
  }

  return pkg;
}
