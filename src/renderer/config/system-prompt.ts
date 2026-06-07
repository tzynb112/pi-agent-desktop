/**
 * PianoAgent system prompt builder.
 * Architecture aligned with Pi Agent CLI's buildSystemPrompt:
 * - Tool snippets for each available tool
 * - Dynamic guidelines based on which tools are enabled
 * - Project context file loading (.piano/prompts/*.md)
 * - Skills injection
 * - Platform-aware shell instructions
 */

export interface SystemPromptOptions {
  agentName?: string;
  selectedTools?: string[];
  toolSnippets?: Record<string, string>;
  promptGuidelines?: string[];
  customSystemPrompt?: string;
  skills?: Array<{ name: string; prompt: string; enabled: boolean }>;
  projectContextFiles?: Array<{ path: string; content: string }>;
  cwd?: string;
}

function getPlatformInfo(): { platform: string; shell: string; commands: string } {
  const platform = typeof process !== 'undefined' && process.platform
    ? process.platform
    : navigator.platform?.toLowerCase() || 'unknown';

  if (platform === 'win32' || platform.includes('win')) {
    return {
      platform: 'Windows',
      shell: 'PowerShell with UTF-8 output',
      commands: `Use PowerShell commands: Get-ChildItem (or dir), Get-Content -Encoding UTF8 (or type), Select-String (or findstr), Get-Command, Get-Location
- Quote Windows paths that contain spaces or non-ASCII characters
- For changing drives and directories, prefer Set-Location "D:\\path\\to\\folder"`,
    };
  }

  if (platform === 'darwin' || platform.includes('mac')) {
    return {
      platform: 'macOS',
      shell: 'bash or zsh',
      commands: `Use Unix commands: ls, cat, grep, which, pwd
- You can use Homebrew commands (brew) for package management`,
    };
  }

  return {
    platform: 'Linux',
    shell: 'bash',
    commands: `Use Unix commands: ls, cat, grep, which, pwd
- You can use apt/yum/pacman for package management depending on distribution`,
  };
}

/** Default tool snippets — one-line descriptions for each built-in tool */
const DEFAULT_TOOL_SNIPPETS: Record<string, string> = {
  read: 'Read file contents',
  bash: 'Execute shell commands',
  edit: 'Make precise edits to files (old_str → new_str replacement)',
  write: 'Create or overwrite files',
  web: 'Fetch a known URL and return cleaned text',
  search: 'Search the web for relevant pages and return result links',
  config: 'Read or modify application settings',
  createTool: 'Create a new custom tool from a script',
  deleteTool: 'Delete a custom tool',
  listTools: 'List all custom tools',
  executeCustomTool: 'Execute a custom tool by name',
};

/** Default guidelines that always appear */
const BASE_GUIDELINES: string[] = [
  'Be concise in your responses. Keep thoughts and explanations very short to speed up execution.',
  'Classify the user intent before acting. Treat greetings, acknowledgements, short phrases, casual chat, and ambiguous one-word messages as conversation unless the user explicitly asks to inspect, create, edit, run, test, open, search, or debug something.',
  'Use tools only when they are necessary for the user request. Do not call read, bash, edit, write, web, config, createTool, deleteTool, listTools, or executeCustomTool for ordinary conversation, greetings, quick confirmations, or vague probes like "hello", "ok", or "smoke".',
  'For unclear short requests, answer briefly or ask one concise clarification instead of guessing a development task and running tools.',
  'For explicit coding or project work, prefer action over commentary. If you have enough context, use tools and make progress instead of explaining what you might do.',
  'For explicit build/create/implement requests, do not stop at a structure, outline, or architecture summary. Start executing with tools immediately; a plan alone is not enough.',
  'Recover proactively from errors: read the error, form the next likely fix, retry with a narrower command or safer edit, and only ask the user when blocked.',
  'Use `search` to discover relevant pages, then use `web` only after you already have a specific URL to fetch.',
  'Keep track of files you have read or changed during the task. Avoid rereading unchanged files unless needed for verification.',
  'After editing files, mention the changed files and the verification you ran.',
  'Write full, complete, production-ready code on the very first try. NEVER write stubs, drafts, or simple placeholders.',
  'Always specify absolute file paths.',
];

/**
 * Build a high-quality system prompt aligned with Pi Agent CLI conventions.
 */
export function buildSystemPrompt(options: SystemPromptOptions = {}): string {
  const {
    agentName = 'PianoAgent',
    selectedTools = Object.keys(DEFAULT_TOOL_SNIPPETS),
    toolSnippets = DEFAULT_TOOL_SNIPPETS,
    promptGuidelines = [],
    customSystemPrompt,
    skills = [],
    projectContextFiles = [],
    cwd,
  } = options;

  const platformInfo = getPlatformInfo();
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const promptCwd = (cwd || '').replace(/\\/g, '/');

  // --- Tools list ---
  const visibleTools = selectedTools.filter((name) => !!toolSnippets[name]);
  const toolsList = visibleTools.length > 0
    ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join('\n')
    : '(none)';

  // --- Dynamic guidelines based on available tools ---
  const guidelines: string[] = [];
  const seen = new Set<string>();
  const add = (g: string) => {
    const norm = g.trim();
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      guidelines.push(norm);
    }
  };

  const hasBash = selectedTools.includes('bash');
  const hasRead = selectedTools.includes('read');

  if (hasBash) {
    add(`Detect the current platform and use appropriate commands. On ${platformInfo.platform}, the shell is ${platformInfo.shell}. ${platformInfo.commands}`);
  }

  for (const g of BASE_GUIDELINES) add(g);
  for (const g of promptGuidelines) add(g);

  const guidelinesText = guidelines.map((g) => `- ${g}`).join('\n');

  // --- XML tool call format instructions ---
  const toolFormatInstructions = `CRITICAL: Tool calls are optional and task-driven. Use a tool only when the user request requires file access, shell execution, editing, writing, web lookup, settings changes, or custom tool work.

Do NOT use tools for greetings, acknowledgements, ordinary conversation, short standalone words, or ambiguous probes. Reply normally instead.

When you do need to use a tool, you MUST output an XML tool call in your response text like this:

To read a file:
<read>
  <file_path>/path/to/file.txt</file_path>
</read>

To write a file:
<write>
  <file_path>/path/to/file.txt</file_path>
  <content>file content here</content>
</write>

To edit a file:
<edit>
  <file_path>/path/to/file.txt</file_path>
  <old_str>text to find</old_str>
  <new_str>replacement text</new_str>
</edit>

To run a command:
<bash>
  <command>your command here</command>
</bash>

To fetch a web page (for documentation, articles, API references):
<web>
  <url>https://example.com/docs</url>
</web>

To search the web for relevant pages:
<search>
  <query>GPT-5.4 mini release info</query>
</search>

To read or modify application settings:
<config>
  <action>list</action>
</config>
<config>
  <action>read</action>
  <key>model</key>
</config>
<config>
  <action>set</action>
  <key>model</key>
  <value>deepseek-v4-pro</value>
</config>

To create a new custom tool (the AI can extend itself!):
<createTool>
  <name>search-github</name>
  <description>Search GitHub repositories</description>
  <script>const args = JSON.parse(process.env.TOOL_ARGS); /* tool logic here */</script>
  <language>javascript</language>
</createTool>

To list custom tools:
<listTools></listTools>

To execute a custom tool:
<executeCustomTool>
  <name>search-github</name>
  <arguments>{"query":"openai docs"}</arguments>
</executeCustomTool>

To delete a custom tool:
<deleteTool>
  <name>search-github</name>
</deleteTool>

Always use ABSOLUTE paths when possible. On Windows use D:\\folder\\file, on Unix use /home/user/file.`;

  // --- Assemble prompt ---
  let prompt = `You are an expert coding assistant named ${agentName} operating inside PianoAgent, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

CRITICAL ENVIRONMENT INFO: You are running on ${platformInfo.platform}. The shell is ${platformInfo.shell}.

Available tools:
${toolsList}

${toolFormatInstructions}

Guidelines:
${guidelinesText}

When the user asks about PianoAgent itself, its commands, settings, or features, refer them to:
- /help — list all available commands
- /doctor — check environment health
- /settings — open the configuration center
- .piano/config.json — project-level configuration
- .piano/prompts/*.md — project-level prompt templates`;

  // --- Custom system prompt ---
  if (customSystemPrompt) {
    prompt += `\n\nCustom Instructions:\n${customSystemPrompt}`;
  }

  // --- Project context files (.piano/prompts/*.md) ---
  if (projectContextFiles.length > 0) {
    prompt += '\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n';
    for (const { path: filePath, content } of projectContextFiles) {
      prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
    }
    prompt += '</project_context>';
  }

  // --- Skills ---
  const enabledSkills = skills.filter((s) => s.enabled);
  if (enabledSkills.length > 0) {
    prompt += `\n\nAdditional skills:\n${enabledSkills.map((s) => `- ${s.name}: ${s.prompt}`).join('\n')}`;
  }

  // --- Date and cwd ---
  prompt += `\n\nCurrent date: ${date}`;
  if (promptCwd) {
    prompt += `\nCurrent working directory: ${promptCwd}`;
  }

  return prompt;
}

/** Static system prompt for backward compatibility */
export const SYSTEM_PROMPT = buildSystemPrompt();

export const WELCOME_MESSAGE = `你好，我是 PianoAgent

你的 AI 编程助手，可以帮你：
- 代码审查
- 解决问题
- 编写代码
- 解释概念

有什么我可以帮你的吗？`;
