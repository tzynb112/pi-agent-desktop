/**
 * Prompt Templates Manager
 * Loads and manages prompt templates from ~/.pi/agent/prompts/ and .pi/prompts/
 */

export interface PromptTemplate {
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
  source: 'global' | 'project';
  filePath: string;
}

interface ParsedTemplate {
  frontmatter: Record<string, string>;
  body: string;
}

/**
 * Parse markdown file with YAML frontmatter
 */
function parseFrontmatter(content: string): ParsedTemplate {
  const match = /^\s*---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(content);
  
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  const frontmatterStr = match[1];
  const body = match[2].trim();
  const frontmatter: Record<string, string> = {};

  for (const line of frontmatterStr.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      if (key) {
        frontmatter[key] = value;
      }
    }
  }

  return { frontmatter, body };
}

/**
 * Expand template arguments
 * Supports: $1, $2, ..., $@, $ARGUMENTS, ${@:N}, ${@:N:L}
 */
export function expandTemplate(content: string, args: string[]): string {
  let result = content;

  // Replace $1, $2, etc.
  for (let i = 0; i < args.length; i++) {
    const pattern = new RegExp(`\\$${i + 1}`, 'g');
    result = result.replace(pattern, args[i]);
  }

  // Replace $@ or $ARGUMENTS with all args joined
  const allArgs = args.join(' ');
  result = result.replace(/\$@/g, allArgs);
  result = result.replace(/\$ARGUMENTS/g, allArgs);

  // Replace ${@:N} (args from position N, 1-indexed)
  const fromNRegex = /\$\{@:(\d+)\}/g;
  result = result.replace(fromNRegex, (_match, nStr) => {
    const n = parseInt(nStr, 10);
    return args.slice(n - 1).join(' ');
  });

  // Replace ${@:N:L} (L args starting from position N, 1-indexed)
  const sliceRegex = /\$\{@:(\d+):(\d+)\}/g;
  result = result.replace(sliceRegex, (_match, nStr, lStr) => {
    const n = parseInt(nStr, 10);
    const l = parseInt(lStr, 10);
    return args.slice(n - 1, n - 1 + l).join(' ');
  });

  return result;
}

/**
 * Load prompt templates from a directory
 */
async function loadTemplatesFromDir(
  dirPath: string,
  source: 'global' | 'project',
  readFile: (path: string) => Promise<string | null>,
  readDir: (path: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }>>
): Promise<PromptTemplate[]> {
  const templates: PromptTemplate[] = [];

  try {
    const entries = await readDir(dirPath);
    const mdFiles = entries.filter(e => !e.isDirectory && e.name.endsWith('.md'));

    for (const file of mdFiles) {
      try {
        const content = await readFile(file.path);
        if (!content) continue;

        const { frontmatter, body } = parseFrontmatter(content);
        const name = file.name.replace(/\.md$/, '');

        templates.push({
          name,
          description: frontmatter.description || body.split('\n')[0] || '',
          argumentHint: frontmatter['argument-hint'],
          content: body,
          source,
          filePath: file.path,
        });
      } catch (err) {
        console.error(`[PromptTemplates] Failed to load template ${file.path}:`, err);
      }
    }
  } catch (err) {
    // Directory might not exist, that's okay
    console.debug(`[PromptTemplates] Could not read directory ${dirPath}:`, err);
  }

  return templates;
}

/**
 * Load all prompt templates from global and project locations
 */
export async function loadAllTemplates(
  readFile: (path: string) => Promise<string | null>,
  readDir: (path: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }>>,
  globalDir: string = 'C:\\Users\\Administrator\\.pi\\agent\\prompts',
  projectDir?: string
): Promise<PromptTemplate[]> {
  const templates: PromptTemplate[] = [];

  // Load global templates
  const globalTemplates = await loadTemplatesFromDir(globalDir, 'global', readFile, readDir);
  templates.push(...globalTemplates);

  // Load project templates
  if (projectDir) {
    const projectTemplates = await loadTemplatesFromDir(projectDir, 'project', readFile, readDir);
    templates.push(...projectTemplates);
  }

  // Deduplicate by name (project wins)
  const seen = new Map<string, PromptTemplate>();
  for (const t of templates) {
    const existing = seen.get(t.name);
    if (!existing || t.source === 'project') {
      seen.set(t.name, t);
    }
  }

  return Array.from(seen.values());
}

/**
 * Save a prompt template to file
 */
export async function saveTemplate(
  name: string,
  description: string,
  content: string,
  targetDir: string,
  writeFile: (path: string, content: string) => Promise<boolean>
): Promise<boolean> {
  const frontmatter = [
    '---',
    `description: ${description}`,
    '---',
  ].join('\n');

  const fullContent = `${frontmatter}\n${content}`;
  const filePath = `${targetDir}\\${name}.md`;

  return writeFile(filePath, fullContent);
}

/**
 * Delete a prompt template file
 */
export async function deleteTemplate(
  filePath: string,
  deleteFile: (path: string) => Promise<boolean>
): Promise<boolean> {
  return deleteFile(filePath);
}
