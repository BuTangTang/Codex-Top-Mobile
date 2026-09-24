import { createProviderTerminalDisplay, type ProviderTerminalDisplayProps } from '@/backends/shared/createProviderTerminalDisplay';

export type CursorTerminalDisplayProps = ProviderTerminalDisplayProps;

export const CursorTerminalDisplay = createProviderTerminalDisplay({
  title: 'Cursor',
  accentColor: 'cyan',
});
