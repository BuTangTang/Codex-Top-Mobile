import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { verifyResumeReachableGemini } from './verifyResumeReachableGemini';

const SESSION_ID = 'e7a9c3d1-5b42-4f0e-9a77-2c8d4b6f1a23';
const CHAT_FILE_NAME = `session-2026-05-20T07-57-${SESSION_ID.slice(0, 8)}.jsonl`;

async function writeGeminiChatFixture(params: Readonly<{
  homeDir: string;
  slug: string;
  cwd?: string;
}>): Promise<string> {
  const chatsDir = join(params.homeDir, '.gemini', 'tmp', params.slug, 'chats');
  await mkdir(chatsDir, { recursive: true });
  const filePath = join(chatsDir, CHAT_FILE_NAME);
  await writeFile(filePath, JSON.stringify({ sessionId: SESSION_ID, kind: 'main' }), 'utf8');
  if (params.cwd) {
    await writeFile(
      join(params.homeDir, '.gemini', 'projects.json'),
      JSON.stringify({ projects: { [params.cwd]: params.slug } }),
      'utf8',
    );
  }
  return filePath;
}

describe('verifyResumeReachableGemini', () => {
  // The non-strict probe falls back to the NATIVE `~/.gemini` home (source proof for
  // native->connected switches), so every test pins HOME to a fresh fake home to stay hermetic
  // on developer machines with real Gemini chats (same pattern as verifyResumeReachablePi.test.ts).
  let fakeNativeHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    fakeNativeHome = await mkdtemp(join(tmpdir(), 'gemini-native-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = fakeNativeHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(fakeNativeHome, { recursive: true, force: true });
  });

  it('proves reachability from the chat session file inside the target materialized home', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gemini-target-'));
    const homeDir = join(rootDir, 'home');
    const cwd = '/workspace/my-project';
    const filePath = await writeGeminiChatFixture({ homeDir, slug: 'my-project', cwd });

    await expect(verifyResumeReachableGemini({
      targetMaterializedRoot: rootDir,
      targetMaterializedEnv: { HOME: homeDir, GEMINI_CLI_HOME: homeDir },
      vendorResumeId: SESSION_ID,
      cwd,
    })).resolves.toEqual({ ok: true, resolvedPath: filePath });
  });

  it('accepts a content-confirmed candidate persisted session file as source proof (non-strict)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gemini-target-'));
    const stagingDir = await mkdtemp(join(tmpdir(), 'gemini-staging-'));
    const candidatePath = join(stagingDir, CHAT_FILE_NAME);
    await writeFile(candidatePath, JSON.stringify({ sessionId: SESSION_ID, kind: 'main' }), 'utf8');

    await expect(verifyResumeReachableGemini({
      targetMaterializedRoot: rootDir,
      targetMaterializedEnv: { HOME: join(rootDir, 'home') },
      vendorResumeId: SESSION_ID,
      cwd: '/workspace/my-project',
      candidatePersistedSessionFile: candidatePath,
    })).resolves.toEqual({ ok: true, resolvedPath: candidatePath });
  });

  it('finds the NATIVE ~/.gemini chat session for a native->connected switch (source proof, non-strict)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gemini-target-'));
    const cwd = '/workspace/native-project';
    const nativeFilePath = await writeGeminiChatFixture({
      homeDir: fakeNativeHome,
      slug: 'native-project',
      cwd,
    });

    // Native->connected: the freshly materialized target home is still empty (the chat import has
    // not run yet); reachability is proven from the native home the switch will import from.
    await expect(verifyResumeReachableGemini({
      targetMaterializedRoot: rootDir,
      targetMaterializedEnv: { HOME: join(rootDir, 'home') },
      vendorResumeId: SESSION_ID,
      cwd,
    })).resolves.toEqual({ ok: true, resolvedPath: nativeFilePath });
  });

  it('targetStrict proves reachability ONLY from the final target home (source-proof fast paths skipped)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gemini-target-'));
    const stagingDir = await mkdtemp(join(tmpdir(), 'gemini-staging-'));
    const candidatePath = join(stagingDir, CHAT_FILE_NAME);
    await writeFile(candidatePath, JSON.stringify({ sessionId: SESSION_ID, kind: 'main' }), 'utf8');
    // Even a NATIVE-home chat must not satisfy the strict spawn gate.
    await writeGeminiChatFixture({ homeDir: fakeNativeHome, slug: 'my-project', cwd: '/workspace/my-project' });

    await expect(verifyResumeReachableGemini({
      targetMaterializedRoot: rootDir,
      targetMaterializedEnv: { HOME: join(rootDir, 'home') },
      vendorResumeId: SESSION_ID,
      cwd: '/workspace/my-project',
      candidatePersistedSessionFile: candidatePath,
      targetStrict: true,
    })).resolves.toEqual({ ok: false, reason: 'gemini_session_file_not_found' });
  });

  it('fails closed when no chat session file exists for the vendor resume id', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gemini-target-'));

    await expect(verifyResumeReachableGemini({
      targetMaterializedRoot: rootDir,
      targetMaterializedEnv: { HOME: join(rootDir, 'home') },
      vendorResumeId: SESSION_ID,
      cwd: '/workspace/my-project',
    })).resolves.toEqual({ ok: false, reason: 'gemini_session_file_not_found' });
  });

  it('fails closed when no vendor resume id is available', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'gemini-target-'));

    await expect(verifyResumeReachableGemini({
      targetMaterializedRoot: rootDir,
      targetMaterializedEnv: {},
      vendorResumeId: null,
      cwd: '/workspace/my-project',
    })).resolves.toEqual({ ok: false, reason: 'gemini_session_file_not_found' });
  });
});
