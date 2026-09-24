import { describe, expect, it } from 'vitest';

import type { SessionConfigOption } from '@/agent/acp/AcpBackend';

import {
  buildCursorSessionModesFromConfigOptions,
  buildCursorSessionModelsFromConfigOptions,
} from './cursorModelConfig';

function modelOption(options: SessionConfigOption['options']): SessionConfigOption {
  return {
    id: 'model',
    name: 'Model',
    type: 'select',
    currentValue: 'default',
    options,
  };
}

describe('buildCursorSessionModelsFromConfigOptions', () => {
  it('groups parameterized Cursor ACP model choices into Happier model options', () => {
    expect(buildCursorSessionModelsFromConfigOptions([
      modelOption([
        { value: 'default[]', name: 'Auto' },
        { value: 'gpt-5.5[context=272k,reasoning=medium,fast=false]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=272k,reasoning=medium,fast=true]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=272k,reasoning=high,fast=false]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=272k,reasoning=high,fast=true]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=1m,reasoning=medium,fast=false]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=1m,reasoning=medium,fast=true]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=1m,reasoning=high,fast=false]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=1m,reasoning=high,fast=true]', name: 'GPT-5.5' },
        { value: 'composer-2.5[fast=true]', name: 'Composer 2.5' },
        { value: 'composer-2.5[fast=false]', name: 'Composer 2.5' },
      ]),
    ])).toEqual({
      currentModelId: 'default',
      availableModels: [
        { id: 'default', name: 'Auto' },
        {
          id: 'gpt-5.5',
          name: 'GPT-5.5',
          modelOptions: [
            {
              id: 'context',
              name: 'Context',
              category: 'model_config',
              type: 'select',
              currentValue: '272k',
              options: [
                { value: '272k', name: '272K' },
                { value: '1m', name: '1M' },
              ],
            },
            {
              id: 'reasoning_effort',
              name: 'Reasoning effort',
              category: 'model_config',
              type: 'select',
              currentValue: 'medium',
              options: [
                { value: 'medium', name: 'Medium' },
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
          id: 'composer-2.5',
          name: 'Composer 2.5',
          modelOptions: [
            {
              id: 'fast',
              name: 'Fast',
              category: 'model_config',
              type: 'select',
              currentValue: 'true',
              options: [
                { value: 'false', name: 'Off' },
                { value: 'true', name: 'Fast' },
              ],
            },
          ],
        },
      ],
    });
  });

  it('attaches real model-scoped ACP config options only to the active Cursor model', () => {
    expect(buildCursorSessionModelsFromConfigOptions([
      {
        ...modelOption([
          { value: 'composer-2.5', name: 'Composer 2.5' },
          { value: 'gpt-5.5', name: 'GPT-5.5' },
        ]),
        currentValue: 'gpt-5.5',
      },
      {
        id: 'context',
        name: 'Context',
        category: 'model_config',
        type: 'select',
        currentValue: '272k',
        options: [
          { value: '272k', name: '272K' },
          { value: '1m', name: '1M' },
        ],
      },
      {
        id: 'reasoning',
        name: 'Reasoning',
        category: 'thought_level',
        type: 'select',
        currentValue: 'high',
        options: [
          { value: 'none', name: 'None' },
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
          { value: 'extra-high', name: 'XHigh' },
        ],
      },
    ])?.availableModels).toEqual([
      {
        id: 'composer-2.5',
        name: 'Composer 2.5',
      },
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        modelOptions: [
          {
            id: 'context',
            name: 'Context',
            category: 'model_config',
            type: 'select',
            currentValue: '272k',
            options: [
              { value: '272k', name: '272K' },
              { value: '1m', name: '1M' },
            ],
          },
          {
            id: 'reasoning_effort',
            name: 'Reasoning effort',
            category: 'thought_level',
            type: 'select',
            currentValue: 'high',
            options: [
              { value: 'none', name: 'None' },
              { value: 'low', name: 'Low' },
              { value: 'medium', name: 'Medium' },
              { value: 'high', name: 'High' },
              { value: 'extra-high', name: 'XHigh' },
            ],
          },
        ],
      },
    ]);
  });

  it('keeps exact parameterized controls scoped to the model choices that advertise them', () => {
    expect(buildCursorSessionModelsFromConfigOptions([
      {
        ...modelOption([
        { value: 'composer-2.5[fast=true]', name: 'Composer 2.5' },
        { value: 'gpt-5.5[context=272k,reasoning=medium,fast=false]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=272k,reasoning=high,fast=false]', name: 'GPT-5.5' },
      ]),
        currentValue: 'gpt-5.5[context=272k,reasoning=medium,fast=false]',
      },
    ])?.availableModels).toEqual([
      {
        id: 'composer-2.5',
        name: 'Composer 2.5',
      },
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        modelOptions: [
          {
            id: 'reasoning_effort',
            name: 'Reasoning effort',
            category: 'model_config',
            type: 'select',
            currentValue: 'medium',
            options: [
              { value: 'medium', name: 'Medium' },
              { value: 'high', name: 'High' },
            ],
          },
        ],
      },
    ]);
  });

  it('canonicalizes Cursor thought_level config options as Happier reasoning effort controls', () => {
    expect(buildCursorSessionModelsFromConfigOptions([
      {
        ...modelOption([
          { value: 'gpt-5.5', name: 'GPT-5.5' },
        ]),
        currentValue: 'gpt-5.5',
      },
      {
        id: 'reasoning',
        name: 'Reasoning',
        category: 'thought_level',
        type: 'select',
        currentValue: 'high',
        options: [
          { value: 'none', name: 'None' },
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
          { value: 'extra-high', name: 'XHigh' },
        ],
      },
      {
        id: 'context',
        name: 'Context',
        category: 'model_config',
        type: 'select',
        currentValue: '272k',
        options: [
          { value: '272k', name: '272K' },
          { value: '1m', name: '1M' },
        ],
      },
    ])?.availableModels[0]?.modelOptions).toEqual([
      {
        id: 'reasoning_effort',
        name: 'Reasoning effort',
        category: 'thought_level',
        type: 'select',
        currentValue: 'high',
        options: [
          { value: 'none', name: 'None' },
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
          { value: 'extra-high', name: 'XHigh' },
        ],
      },
      {
        id: 'context',
        name: 'Context',
        category: 'model_config',
        type: 'select',
        currentValue: '272k',
        options: [
          { value: '272k', name: '272K' },
          { value: '1m', name: '1M' },
        ],
      },
    ]);
  });

  it('does not surface Cursor fast option descriptions as model-picker subtitles', () => {
    const result = buildCursorSessionModelsFromConfigOptions([
      {
        ...modelOption([
          { value: 'composer-2.5', name: 'Composer 2.5' },
        ]),
        currentValue: 'composer-2.5',
      },
      {
        id: 'fast',
        name: 'Fast',
        description: 'Faster speeds.',
        category: 'model_config',
        type: 'boolean',
        currentValue: true,
      },
    ]);

    expect(result?.availableModels[0]?.modelOptions).toEqual([
      {
        id: 'fast',
        name: 'Fast',
        category: 'model_config',
        type: 'select',
        currentValue: 'true',
        options: [
          { value: 'false', name: 'Off' },
          { value: 'true', name: 'Fast' },
        ],
      },
    ]);
  });

  it('uses the current parameterized variant to populate model option current values', () => {
    const result = buildCursorSessionModelsFromConfigOptions([{
      ...modelOption([
        { value: 'gpt-5.5[context=272k,reasoning=medium,fast=false]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=272k,reasoning=medium,fast=true]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=272k,reasoning=high,fast=false]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=272k,reasoning=high,fast=true]', name: 'GPT-5.5' },
      ]),
      currentValue: 'gpt-5.5[context=272k,reasoning=high,fast=true]',
    }]);

    expect(result?.currentModelId).toBe('gpt-5.5');
    expect(result?.availableModels[0]?.modelOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'reasoning_effort', currentValue: 'high' }),
      expect.objectContaining({ id: 'fast', currentValue: 'true' }),
    ]));
  });

  it('keeps sparse parameterized choices exact instead of inventing independent controls', () => {
    const result = buildCursorSessionModelsFromConfigOptions([{
      ...modelOption([
        { value: 'gpt-5.5[context=272k,reasoning=medium,fast=false]', name: 'GPT-5.5' },
        { value: 'gpt-5.5[context=1m,reasoning=high,fast=true]', name: 'GPT-5.5' },
      ]),
      currentValue: 'gpt-5.5[context=272k,reasoning=medium,fast=false]',
    }]);

    expect(result?.currentModelId).toBe('gpt-5.5[context=272k,reasoning=medium,fast=false]');
    expect(result?.availableModels.map((model) => ({
      id: model.id,
      hasModelOptions: Boolean(model.modelOptions?.length),
    }))).toEqual([
      {
        id: 'gpt-5.5[context=272k,reasoning=medium,fast=false]',
        hasModelOptions: false,
      },
      {
        id: 'gpt-5.5[context=1m,reasoning=high,fast=true]',
        hasModelOptions: false,
      },
    ]);
  });

  it('does not treat mode-only ACP config options as Cursor models', () => {
    expect(buildCursorSessionModelsFromConfigOptions([{
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: 'ask',
      options: [
        { value: 'ask', name: 'Ask' },
        { value: 'plan', name: 'Plan' },
      ],
    }])).toBeNull();
  });
});

describe('buildCursorSessionModesFromConfigOptions', () => {
  it('derives Cursor ACP modes from the mode config option', () => {
    expect(buildCursorSessionModesFromConfigOptions([{
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: 'ask',
      options: [
        { value: 'ask', name: 'Ask' },
        { value: 'plan', name: 'Plan' },
      ],
    }])).toEqual({
      currentModeId: 'ask',
      availableModes: [
        { id: 'ask', name: 'Ask' },
        { id: 'plan', name: 'Plan' },
      ],
    });
  });

  it('does not treat model config options as Cursor modes', () => {
    expect(buildCursorSessionModesFromConfigOptions([
      modelOption([
        { value: 'composer-2.5[fast=true]', name: 'Composer 2.5' },
      ]),
    ])).toBeNull();
  });
});
