/**
 * Tool Creator — Allow the AI to create custom tools dynamically.
 * The AI writes a script, and it becomes a callable tool.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { spawn } from 'child_process';

const TOOLS_DIR = path.join(app.getPath('userData'), 'piano-tools');

/** Protected tools that cannot be deleted or overridden */
const PROTECTED_TOOLS = new Set(['read', 'write', 'edit', 'bash', 'web', 'config']);

export interface CustomToolDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  script: string;  // The script content
  language: 'javascript' | 'python' | 'shell';
  createdAt: number;
}

/** Ensure tools directory exists */
function ensureToolsDir(): void {
  if (!fs.existsSync(TOOLS_DIR)) {
    fs.mkdirSync(TOOLS_DIR, { recursive: true });
  }
}

/** Save a custom tool definition */
export function saveCustomTool(def: CustomToolDef): { success: boolean; error?: string } {
  try {
    if (PROTECTED_TOOLS.has(def.name)) {
      return { success: false, error: `Cannot override protected tool "${def.name}". Core tools (read, write, edit, bash, web, config) cannot be modified.` };
    }
    ensureToolsDir();
    const safeName = def.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const toolPath = path.join(TOOLS_DIR, `${safeName}.json`);
    fs.writeFileSync(toolPath, JSON.stringify({ ...def, createdAt: Date.now() }, null, 2), 'utf-8');

    // Also write the script file
    const ext = def.language === 'python' ? '.py' : def.language === 'shell' ? (process.platform === 'win32' ? '.ps1' : '.sh') : '.js';
    const scriptPath = path.join(TOOLS_DIR, `${safeName}${ext}`);
    fs.writeFileSync(scriptPath, def.script, 'utf-8');

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** Load all custom tools */
export function loadCustomTools(): CustomToolDef[] {
  try {
    ensureToolsDir();
    const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, f), 'utf-8')) as CustomToolDef;
      } catch {
        return null;
      }
    }).filter((t): t is CustomToolDef => t !== null);
  } catch {
    return [];
  }
}

/** Delete a custom tool */
export function deleteCustomTool(name: string): { success: boolean; error?: string } {
  try {
    if (PROTECTED_TOOLS.has(name)) {
      return { success: false, error: `Cannot delete protected tool "${name}". Core tools (read, write, edit, bash, web, config) cannot be deleted.` };
    }
    ensureToolsDir();
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const toolPath = path.join(TOOLS_DIR, `${safeName}.json`);
    if (fs.existsSync(toolPath)) fs.unlinkSync(toolPath);

    // Delete script files
    for (const ext of ['.js', '.py', '.ps1', '.sh']) {
      const scriptPath = path.join(TOOLS_DIR, `${safeName}${ext}`);
      if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** Execute a custom tool */
export function executeCustomTool(name: string, args: Record<string, any>): Promise<{ success: boolean; result?: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      ensureToolsDir();
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');

      // Load tool definition
      const toolPath = path.join(TOOLS_DIR, `${safeName}.json`);
      if (!fs.existsSync(toolPath)) {
        resolve({ success: false, error: `Custom tool "${name}" not found` });
        return;
      }

      const def: CustomToolDef = JSON.parse(fs.readFileSync(toolPath, 'utf-8'));
      const ext = def.language === 'python' ? '.py' : def.language === 'shell' ? (process.platform === 'win32' ? '.ps1' : '.sh') : '.js';
      const scriptPath = path.join(TOOLS_DIR, `${safeName}${ext}`);

      if (!fs.existsSync(scriptPath)) {
        resolve({ success: false, error: `Script file not found for tool "${name}"` });
        return;
      }

      // Build command
      let cmd: string;
      let cmdArgs: string[];

      if (def.language === 'python') {
        cmd = 'python';
        cmdArgs = [scriptPath];
      } else if (def.language === 'shell') {
        if (process.platform === 'win32') {
          cmd = 'powershell.exe';
          cmdArgs = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];
        } else {
          cmd = 'bash';
          cmdArgs = [scriptPath];
        }
      } else {
        cmd = 'node';
        cmdArgs = [scriptPath];
      }

      // Pass args as environment variable
      const env = { ...process.env, TOOL_ARGS: JSON.stringify(args) };

      const child = spawn(cmd, cmdArgs, {
        env,
        timeout: 30000,
        windowsHide: true,
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, result: stdout.trim() || 'Tool executed successfully' });
        } else {
          resolve({ success: false, error: stderr.trim() || `Tool exited with code ${code}` });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    } catch (err: any) {
      resolve({ success: false, error: err.message });
    }
  });
}
