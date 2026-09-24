import type { AgentChecklistContributions } from '@/backends/types';

export const checklists = {
  'resume.cursor': [{ id: 'cli.cursor', params: { includeLoginStatus: true } }],
} satisfies AgentChecklistContributions;
