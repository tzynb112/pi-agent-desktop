export const TOOLS_DEFINITION = [
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read the contents of a file from the filesystem',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The path to the file to read',
          },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write',
      description: 'Write content to a file, creating directories if needed',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The path to the file to write',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Edit a file by replacing old text with new text',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The path to the file to edit',
          },
          old_str: {
            type: 'string',
            description: 'The text to find and replace',
          },
          new_str: {
            type: 'string',
            description: 'The replacement text',
          },
        },
        required: ['file_path', 'old_str', 'new_str'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command and return the output',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory. Use the current project root when operating on project files.',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web',
      description: 'Fetch a web page and return cleaned text content. Strips ads, navigation, scripts. Useful for reading documentation, articles, and API references.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch',
          },
          max_length: {
            type: 'number',
            description: 'Maximum content length in characters (default: 15000)',
          },
          extract_links: {
            type: 'boolean',
            description: 'Whether to extract links from the page (default: true)',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'config',
      description: 'Read or modify application settings. Use action "list" to see all settings, "read" to get a specific setting, "set" to change a setting. Keys: model, baseURL, apiKey, agentName, temperature, maxTokens, reasoningEffort, autoResumeGoals, sandboxType, themePreset, accentColor, bubbleStyle, interfaceDensity.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'set', 'list'],
            description: 'Operation: "list" shows all settings, "read" gets one setting, "set" changes one setting',
          },
          key: {
            type: 'string',
            description: 'Setting key (dot notation for nested, e.g., "modelProfiles.0.model"). Required for read/set.',
          },
          value: {
            description: 'New value for set action. Can be string, number, boolean, or object.',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createTool',
      description: 'Create a new custom tool by writing a script. The tool becomes immediately available. Use JavaScript, Python, or Shell. Args are passed via TOOL_ARGS env var as JSON.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Tool name (alphanumeric, hyphens, underscores)',
          },
          description: {
            type: 'string',
            description: 'What the tool does',
          },
          parameters: {
            type: 'object',
            description: 'Parameter definitions as { paramName: { type, description, required } }',
          },
          script: {
            type: 'string',
            description: 'The script content. Read args from process.env.TOOL_ARGS (JSON) in JS/Python, or $TOOL_ARGS in shell.',
          },
          language: {
            type: 'string',
            enum: ['javascript', 'python', 'shell'],
            description: 'Script language (default: javascript)',
          },
        },
        required: ['name', 'script'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteTool',
      description: 'Delete a custom tool that was previously created.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the tool to delete',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listTools',
      description: 'List all custom tools that have been created.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'executeCustomTool',
      description: 'Execute a custom tool by name with arguments.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the custom tool to execute',
          },
          arguments: {
            type: 'object',
            description: 'Arguments to pass to the tool',
          },
        },
        required: ['name'],
      },
    },
  },
];
