import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                            Text: (props: any) => React.createElement('RNText', props, props.children),
                            TextInput: (props: any) => React.createElement('RNTextInput', props, props.children),
                        }
    );
});

vi.mock('@/constants/Typography', () => ({
  Typography: { default: () => ({}), mono: () => ({}) },
}));

vi.mock('@/sync/store/hooks', () => ({
  useLocalSetting: () => 1,
}));

vi.mock('./uiFontScale', () => ({
  scaleTextStyle: (style: any) => style,
}));

function flattenStyle(style: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!style) return [];
  if (!Array.isArray(style)) return [style as Record<string, unknown>];
  return style.flatMap((entry) => flattenStyle(entry));
}

function hasNoOutlineStyle(style: unknown): boolean {
  return flattenStyle(style).some((entry) => (
    entry.outline === 'none'
    && entry.boxShadow === 'none'
  ));
}

describe('Text (selectability scope)', () => {
  it('defaults to non-selectable without a scope', async () => {
    const { Text } = await import('./Text');

    const screen = await renderScreen(<Text>hello</Text>);
    const rnText = screen.findByType('RNText' as any);
    expect(rnText.props.selectable).toBe(false);
  });

  it('defaults to selectable within a selectability scope', async () => {
    const { Text, TextSelectabilityScope } = await import('./Text');

    const screen = await renderScreen(
      <TextSelectabilityScope selectable>
        <Text>hello</Text>
      </TextSelectabilityScope>,
    );
    const rnText = screen.findByType('RNText' as any);
    expect(rnText.props.selectable).toBe(true);
  });

  it('respects an explicit selectable={false} even within a scope', async () => {
    const { Text, TextSelectabilityScope } = await import('./Text');

    const screen = await renderScreen(
      <TextSelectabilityScope selectable>
        <Text selectable={false}>hello</Text>
      </TextSelectabilityScope>,
    );
    const rnText = screen.findByType('RNText' as any);
    expect(rnText.props.selectable).toBe(false);
  });

  it('does not apply the web input outline reset to plain text nodes', async () => {
    const { Text } = await import('./Text');

    const screen = await renderScreen(<Text>hello</Text>);
    const rnText = screen.findByType('RNText' as any);

    expect(hasNoOutlineStyle(rnText.props.style)).toBe(false);
  });

  it('applies the web input outline reset to text inputs', async () => {
    const { TextInput } = await import('./Text');

    const screen = await renderScreen(<TextInput value="hello" onChangeText={() => {}} />);
    const rnTextInput = screen.findByType('RNTextInput' as any);

    expect(hasNoOutlineStyle(rnTextInput.props.style)).toBe(true);
  });
});
