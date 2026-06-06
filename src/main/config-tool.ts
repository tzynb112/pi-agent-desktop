/**
 * Config Tool — Allow the AI to read and modify application settings.
 * Enables natural language configuration like "switch to deepseek-v4-pro" or "enable auto resume".
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { writeJsonFileAtomic } from './state-store';

interface ConfigOperation {
  success: boolean;
  action?: string;
  key?: string;
  value?: any;
  message?: string;
  error?: string;
}

/**
 * Execute a config operation: read, set, or list settings.
 */
export function executeConfigOperation(args: {
  action: 'read' | 'set' | 'list';
  key?: string;
  value?: any;
}): ConfigOperation {
  const settingsPath = path.join(app.getPath('userData'), 'piano-settings.json');

  try {
    // Read current settings
    let settings: any = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }

    switch (args.action) {
      case 'read': {
        if (!args.key) {
          return { success: true, action: 'read', value: settings, message: 'Full settings returned' };
        }
        const value = getNestedValue(settings, args.key);
        return { success: true, action: 'read', key: args.key, value, message: `${args.key} = ${JSON.stringify(value)}` };
      }

      case 'set': {
        if (!args.key || args.value === undefined) {
          return { success: false, error: 'Missing key or value for set action' };
        }
        setNestedValue(settings, args.key, args.value);
        writeJsonFileAtomic(settingsPath, settings);
        return { success: true, action: 'set', key: args.key, value: args.value, message: `Set ${args.key} = ${JSON.stringify(args.value)}` };
      }

      case 'list': {
        // Return a summary of all settings
        const summary = {
          model: settings.model,
          baseURL: settings.baseURL,
          agentName: settings.agentName,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          reasoningEffort: settings.reasoningEffort,
          autoResumeGoals: settings.autoResumeGoals,
          sandboxType: settings.sandboxType,
          themePreset: settings.themePreset,
          accentColor: settings.accentColor,
          bubbleStyle: settings.bubbleStyle,
          interfaceDensity: settings.interfaceDensity,
          modelProfiles: settings.modelProfiles?.map((p: any) => ({ id: p.id, name: p.name, model: p.model })),
          skillsCount: settings.skills?.length || 0,
          mcpServersCount: settings.mcpServers?.length || 0,
        };
        return { success: true, action: 'list', value: summary, message: 'Settings summary returned' };
      }

      default:
        return { success: false, error: `Unknown action: ${args.action}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Config operation failed' };
  }
}

/** Get a nested value by dot-notation key (e.g., "modelProfiles.0.name") */
function getNestedValue(obj: any, key: string): any {
  const parts = key.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[parseInt(part)];
    } else {
      current = current[part];
    }
  }
  return current;
}

/** Set a nested value by dot-notation key */
function setNestedValue(obj: any, key: string, value: any): void {
  const parts = key.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    if (current[part] === undefined) {
      current[part] = /^\d+$/.test(nextPart) ? [] : {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}
