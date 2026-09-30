import { describe, expect, it } from 'vitest';
import { projectDirectTranscriptItems, DirectTranscriptPageRequestSchema, DirectTranscriptReadAfterRequestSchema } from './daemonRpcV1';

const item = (id: string, role: string, content: unknown) => ({ id, createdAtMs: 100, localId: id, raw: { role, content } });
describe('conversation text projection', () => {
  it('keeps complete user and main agent text with original identities, omitting tools and sidechains', () => {
    const user = item('u', 'user', { type: 'text', text: '  ' + 'a'.repeat(1100000) + '\n' });
    const agent = item('a', 'agent', { type: 'codex', data: { type: 'message', message: 'answer' } });
    const tool = item('t', 'agent', { type: 'codex', data: { type: 'tool-call', input: 'x'.repeat(1500000) } });
    const side = item('s', 'agent', { type: 'codex', data: { type: 'message', message: 'side', sidechainId: 'child' } });
    const items = [user, tool, agent, side, item('empty', 'user', { type: 'text', text: ' ' }), item('bad', 'agent', null)];
    expect(projectDirectTranscriptItems(items)).toBe(items);
    const projected = projectDirectTranscriptItems(items, 'conversation_text');
    expect(projected).toEqual([user, agent]);
    expect(projected[0]).toBe(user);
    expect(projectDirectTranscriptItems([tool], 'conversation_text')).toEqual([]);
  });
  it('keeps attachment-only main messages but does not admit attachment tools or sidechains', () => {
    const meta = { happier: { kind: 'attachments.v1', payload: { attachments: [{ name: 'image.png', path: '/tmp/image.png', kind: 'image' }] } } };
    const user = { ...item('image', 'user', { type: 'text', text: '' }), raw: { role: 'user', content: { type: 'text', text: '' }, meta } };
    const agent = { ...item('file', 'agent', {}), raw: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: '' } }, meta } };
    const tool = { ...agent, raw: { ...agent.raw, content: { type: 'codex', data: { type: 'tool-call', message: '' } } } };
    const side = { ...agent, raw: { ...agent.raw, content: { type: 'codex', data: { type: 'message', message: '', sidechainId: 'child' } } } };
    expect(projectDirectTranscriptItems([user, agent, tool, side], 'conversation_text')).toEqual([user, agent]);
  });
  it('accepts opt-in on both requests and keeps it optional for released callers', () => {
    const base = { machineId: 'm', providerId: 'codex', remoteSessionId: 'r', source: { kind: 'codexHome', home: 'user', homePath: '/tmp/isolated' }, cursor: 'cursor', direction: 'older' };
    for (const schema of [DirectTranscriptPageRequestSchema, DirectTranscriptReadAfterRequestSchema]) {
      expect(schema.safeParse(base).success).toBe(true);
      expect(schema.safeParse({ ...base, projection: 'conversation_text' }).success).toBe(true);
      expect(schema.safeParse({ ...base, projection: 'typo' }).success).toBe(false);
    }
  });
});
