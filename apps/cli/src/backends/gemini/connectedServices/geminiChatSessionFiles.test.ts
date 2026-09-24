import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findGeminiChatSessionFile,
  importGeminiChatSessionForResume,
  readGeminiChatSessionFileSessionId,
} from './geminiChatSessionFiles';

const SESSION_ID = '12740866-141f-4f73-afab-76bd38cf2e87';
const CHAT_FILE_NAME = `session-2026-05-20T07-57-${SESSION_ID.slice(0, 8)}.jsonl`;

async function writeGeminiChatFixture(params: Readonly<{
  homeDir: string;
  slug: string;
  cwd?: string;
  sessionId?: string;
  fileName?: string;
}>): Promise<string> {
  const sessionId = params.sessionId ?? SESSION_ID;
  const chatsDir = join(params.homeDir, '.gemini', 'tmp', params.slug, 'chats');
  await mkdir(chatsDir, { recursive: true });
  const filePath = join(chatsDir, params.fileName ?? CHAT_FILE_NAME);
  await writeFile(filePath, [
    JSON.stringify({ sessionId, projectHash: 'hash', startTime: 't', lastUpdated: 't', kind: 'main' }),
    JSON.stringify({ id: 'm1', type: 'user', content: [{ text: 'hello' }] }),
  ].join('\n'), 'utf8');
  if (params.cwd) {
    await writeFile(
      join(params.homeDir, '.gemini', 'projects.json'),
      JSON.stringify({ projects: { [params.cwd]: params.slug } }),
      'utf8',
    );
  }
  return filePath;
}

describe('readGeminiChatSessionFileSessionId', () => {
  it('reads the session id from the first jsonl record', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'gemini-chats-'));
    const filePath = await writeGeminiChatFixture({ homeDir, slug: 'proj' });
    await expect(readGeminiChatSessionFileSessionId(filePath)).resolves.toBe(SESSION_ID);
  });

  it('returns null for missing files', async () => {
    await expect(readGeminiChatSessionFileSessionId('/nonexistent/file.jsonl')).resolves.toBeNull();
  });
});

describe('findGeminiChatSessionFile', () => {
  it('finds the chat file through the projects.json slug mapping for the cwd', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'gemini-chats-'));
    const cwd = '/workspace/my-project';
    const filePath = await writeGeminiChatFixture({ homeDir, slug: 'my-project', cwd });

    await expect(findGeminiChatSessionFile({
      geminiDir: join(homeDir, '.gemini'),
      sessionId: SESSION_ID,
      cwd,
    })).resolves.toEqual({ filePath, projectSlug: 'my-project' });
  });

  it('falls back to scanning all project tmp dirs when no projects.json mapping exists', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'gemini-chats-'));
    const filePath = await writeGeminiChatFixture({ homeDir, slug: 'other-slug' });

    await expect(findGeminiChatSessionFile({
      geminiDir: join(homeDir, '.gemini'),
      sessionId: SESSION_ID,
      cwd: '/workspace/unmapped',
    })).resolves.toEqual({ filePath, projectSlug: 'other-slug' });
  });

  it('rejects files whose filename matches but whose content belongs to another session', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'gemini-chats-'));
    await writeGeminiChatFixture({
      homeDir,
      slug: 'proj',
      sessionId: '99999999-0000-0000-0000-000000000000',
      fileName: CHAT_FILE_NAME,
    });

    await expect(findGeminiChatSessionFile({
      geminiDir: join(homeDir, '.gemini'),
      sessionId: SESSION_ID,
      cwd: null,
    })).resolves.toBeNull();
  });
});

describe('importGeminiChatSessionForResume', () => {
  it('imports the native chat session into the target home and registers the project mapping', async () => {
    const sourceHome = await mkdtemp(join(tmpdir(), 'gemini-native-home-'));
    const targetHome = await mkdtemp(join(tmpdir(), 'gemini-target-home-'));
    const cwd = '/workspace/my-project';
    const sourcePath = await writeGeminiChatFixture({ homeDir: sourceHome, slug: 'my-project', cwd });

    const result = await importGeminiChatSessionForResume({
      targetHomeDir: targetHome,
      sourceEnv: { HOME: sourceHome },
      cwd,
      vendorResumeId: SESSION_ID,
    });

    expect(result.imported).toBe(true);
    const destinationPath = join(targetHome, '.gemini', 'tmp', 'my-project', 'chats', CHAT_FILE_NAME);
    expect(result.destinationPath).toBe(destinationPath);
    expect(await readFile(destinationPath, 'utf8')).toBe(await readFile(sourcePath, 'utf8'));
    const projects = JSON.parse(await readFile(join(targetHome, '.gemini', 'projects.json'), 'utf8'));
    expect(projects).toEqual({ projects: { [cwd]: 'my-project' } });
  });

  it('is idempotent when the chat session is already present in the target home', async () => {
    const sourceHome = await mkdtemp(join(tmpdir(), 'gemini-native-home-'));
    const targetHome = await mkdtemp(join(tmpdir(), 'gemini-target-home-'));
    const cwd = '/workspace/my-project';
    await writeGeminiChatFixture({ homeDir: sourceHome, slug: 'my-project', cwd });

    const first = await importGeminiChatSessionForResume({
      targetHomeDir: targetHome,
      sourceEnv: { HOME: sourceHome },
      cwd,
      vendorResumeId: SESSION_ID,
    });
    const second = await importGeminiChatSessionForResume({
      targetHomeDir: targetHome,
      sourceEnv: { HOME: sourceHome },
      cwd,
      vendorResumeId: SESSION_ID,
    });

    expect(first.imported).toBe(true);
    expect(second.imported).toBe(false);
    expect(second.reason).toBe('already_present');
    expect(second.destinationPath).toBe(first.destinationPath);
  });

  it('imports from a candidate persisted session file when the source home has no copy', async () => {
    const stagingDir = await mkdtemp(join(tmpdir(), 'gemini-staging-'));
    const emptySourceHome = await mkdtemp(join(tmpdir(), 'gemini-native-home-'));
    const targetHome = await mkdtemp(join(tmpdir(), 'gemini-target-home-'));
    const cwd = '/workspace/my-project';
    const candidateDir = join(stagingDir, 'chats');
    await mkdir(candidateDir, { recursive: true });
    const candidatePath = join(candidateDir, CHAT_FILE_NAME);
    await writeFile(candidatePath, JSON.stringify({ sessionId: SESSION_ID, kind: 'main' }), 'utf8');

    const result = await importGeminiChatSessionForResume({
      targetHomeDir: targetHome,
      sourceEnv: { HOME: emptySourceHome },
      cwd,
      vendorResumeId: SESSION_ID,
      candidatePersistedSessionFile: candidatePath,
    });

    expect(result.imported).toBe(true);
    expect(result.destinationPath).toBe(join(targetHome, '.gemini', 'tmp', 'my-project', 'chats', CHAT_FILE_NAME));
  });

  it('reports a structured miss when the session cannot be found anywhere', async () => {
    const emptySourceHome = await mkdtemp(join(tmpdir(), 'gemini-native-home-'));
    const targetHome = await mkdtemp(join(tmpdir(), 'gemini-target-home-'));

    const result = await importGeminiChatSessionForResume({
      targetHomeDir: targetHome,
      sourceEnv: { HOME: emptySourceHome },
      cwd: '/workspace/my-project',
      vendorResumeId: SESSION_ID,
    });

    expect(result.imported).toBe(false);
    expect(result.reason).toBe('source_session_file_not_found');
  });
});
