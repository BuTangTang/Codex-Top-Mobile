import { describe, expect, it } from 'vitest';

import { parseCursorCliModels } from './cursorCliModelsProbe';

describe('parseCursorCliModels', () => {
  it('normalizes Cursor auto and derives options only for models with advertised variants', () => {
    expect(parseCursorCliModels([
      'Available models',
      'auto - Auto',
      'composer-2.5 - Composer 2.5',
      'composer-2.5-fast - Composer 2.5 Fast (default)',
      'gpt-5.5-none - GPT-5.5 1M None',
      'gpt-5.5-high-fast - GPT-5.5 High Fast',
      'gemini-3.1-pro - Gemini 3.1 Pro',
      '',
    ].join('\n'))).toEqual([
      {
        id: 'default',
        name: 'Auto',
      },
      {
        id: 'composer-2.5',
        name: 'Composer 2.5',
        modelOptions: [
          {
            id: 'fast',
            name: 'Fast',
            category: 'model_config',
            type: 'select',
            currentValue: 'false',
            options: [
              { value: 'false', name: 'Off' },
              { value: 'true', name: 'Fast' },
            ],
          },
        ],
      },
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5 1M None',
        modelOptions: [
          {
            id: 'reasoning_effort',
            name: 'Reasoning effort',
            category: 'model_config',
            type: 'select',
            currentValue: 'none',
            options: [
              { value: 'none', name: 'None' },
              { value: 'high', name: 'High' },
            ],
          },
          {
            id: 'fast',
            name: 'Fast',
            category: 'model_config',
            type: 'select',
            currentValue: 'false',
            options: [
              { value: 'false', name: 'Off' },
              { value: 'true', name: 'Fast' },
            ],
          },
        ],
      },
      {
        id: 'gemini-3.1-pro',
        name: 'Gemini 3.1 Pro',
      },
    ]);
  });
});
