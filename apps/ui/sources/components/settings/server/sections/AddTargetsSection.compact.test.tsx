import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

installSettingsViewCommonModuleMocks();
vi.mock('@/components/ui/lists/Item', () => ({ Item: (props: any) => React.createElement('Item', props) }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: ({ children }: any) => React.createElement('ItemGroup', null, children) }));
vi.mock('@/components/ui/buttons/RoundButton', () => ({ RoundButton: (props: any) => React.createElement('RoundButton', props) }));
vi.mock('@/components/ui/text/Text', () => ({ Text: ({ children }: any) => React.createElement('Text', null, children), TextInput: (props: any) => React.createElement('TextInput', props) }));

/** 用合成服务器验证地址提交仍落到既有控制器。 */
function props(compact: boolean) {
    return { compact, autoMode: false, inputUrl: 'https://example.test', inputName: '', error: null, isValidating: false, defaultExpanded: 'server' as const, onChangeUrl: vi.fn(), onChangeName: vi.fn(), onResetServer: vi.fn(), onAddServer: vi.fn(), servers: [], activeServerId: '', onCreateServerGroup: vi.fn() };
}
describe('compact server address', () => {
    it('keeps address entry and validation action without expert controls', async () => {
        const { AddTargetsSection } = await import('./AddTargetsSection');
        const value = props(true);
        const screen = await renderScreen(<AddTargetsSection {...value} />);
        const input = screen.findByTestId('server-settings-add-url-input');
        input!.props.onChangeText('https://changed.example.test');
        expect(value.onChangeUrl).toHaveBeenCalledWith('https://changed.example.test');
        expect(screen.findByTestId('server-settings-add-name-input')).toBeNull();
        expect(screen.findByTestId('server-settings-add-reset')).toBeNull();
        expect(screen.findAllByType('Item' as any).some((item) => item.props.title === 'server.addServerGroupTitle')).toBe(false);
        await screen.findByTestId('server-settings-add-confirm')!.props.action();
        expect(value.onAddServer).toHaveBeenCalledOnce();
    });
    it('retains desktop name, reset and group controls', async () => {
        const { AddTargetsSection } = await import('./AddTargetsSection');
        const screen = await renderScreen(<AddTargetsSection {...props(false)} />);
        expect(screen.findByTestId('server-settings-add-name-input')).not.toBeNull();
        expect(screen.findByTestId('server-settings-add-reset')).not.toBeNull();
        expect(screen.findAllByType('Item' as any).some((item) => item.props.title === 'server.addServerGroupTitle')).toBe(true);
    });
});
