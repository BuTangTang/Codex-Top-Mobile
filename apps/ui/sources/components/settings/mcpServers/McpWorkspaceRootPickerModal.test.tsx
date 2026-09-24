import * as React from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import {
    installMcpServersCommonModuleMocks,
    mcpServersModuleState,
    resetMcpServersCommonModuleMockState,
} from './mcpServersTestHelpers';


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pathSelectionListPropsRef: { current: Record<string, unknown> | null } = { current: null };

installMcpServersCommonModuleMocks();

vi.mock('@/components/sessions/new/components/PathSelectionList', () => ({
  PathSelectionList: (props: Record<string, unknown>) => {
    pathSelectionListPropsRef.current = props;
    return React.createElement('PathSelectionList', props);
  },
}));

describe('McpWorkspaceRootPickerModal', () => {
  beforeEach(() => {
    resetMcpServersCommonModuleMockState();
    pathSelectionListPropsRef.current = null;
  });

  it('passes the machine id and home dir into PathSelectionList when machine information is provided', async () => {
    const { McpWorkspaceRootPickerModal } = await import('./McpWorkspaceRootPickerModal');

    await renderScreen(<McpWorkspaceRootPickerModal
          machineId="machine-1"
          machineHomeDir="/Users/test"
          selectedPath="/repo"
          favoriteDirectories={[]}
          onChangeFavoriteDirectories={() => {}}
          onSelectPath={() => {}}
          onClose={() => {}}
        />);

    expect(pathSelectionListPropsRef.current).toMatchObject({
      machineId: 'machine-1',
      machineHomeDir: '/Users/test',
      initialValue: '/repo',
    });
    expect(mcpServersModuleState.openMachinePathBrowserModalSpy).not.toHaveBeenCalled();
  });

  it('forwards home-aware favorite toggles to PathSelectionList', async () => {
    const onChangeFavoriteDirectories = vi.fn();
    const { McpWorkspaceRootPickerModal } = await import('./McpWorkspaceRootPickerModal');

    await renderScreen(<McpWorkspaceRootPickerModal
          machineId="machine-1"
          machineHomeDir="/Users/test"
          selectedPath="/repo"
          favoriteDirectories={['~/repo']}
          onChangeFavoriteDirectories={onChangeFavoriteDirectories}
          onSelectPath={() => {}}
          onClose={() => {}}
        />);

    const isFavorite = pathSelectionListPropsRef.current?.isFavorite;
    const onToggleFavorite = pathSelectionListPropsRef.current?.onToggleFavorite;
    expect(typeof isFavorite).toBe('function');
    expect(typeof onToggleFavorite).toBe('function');
    expect((isFavorite as (path: string) => boolean)('/Users/test/repo')).toBe(true);

    (onToggleFavorite as (path: string) => void)('/Users/test/repo');

    expect(onChangeFavoriteDirectories).toHaveBeenCalledWith([]);
  });
});
