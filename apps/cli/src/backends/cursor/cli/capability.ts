import { createAcpCliCapability } from '@/capabilities/probes/createAcpCliCapability';
import { cursorTransport } from '@/backends/cursor/acp/transport';

export const cliCapability = createAcpCliCapability({
  agentId: 'cursor',
  title: 'Cursor Agent CLI',
  acpArgs: ['acp'],
  transport: cursorTransport,
});
