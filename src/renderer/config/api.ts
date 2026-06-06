/**
 * PianoAgent API Configuration
 * DeepSeek API integration
 */

export const API_CONFIG = {
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: '',
    models: {
      flash: 'deepseek-v4-flash',
      pro: 'deepseek-v4-pro',
    },
  },
};

export const DEFAULT_MODEL = 'deepseek-v4-flash';
