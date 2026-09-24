import { afterEach, describe, expect, it, vi } from 'vitest';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { updateLocalGeminiCredentials } from './updateLocalCredentials';

describe('updateLocalGeminiCredentials', () => {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousGeminiCliHome = process.env.GEMINI_CLI_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    if (previousGeminiCliHome === undefined) delete process.env.GEMINI_CLI_HOME;
    else process.env.GEMINI_CLI_HOME = previousGeminiCliHome;
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      rmSync(String(tempDirs.pop()), { recursive: true, force: true });
    }
  });

  it('writes oauth_creds.json under the expanded GEMINI_CLI_HOME path', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-gemini-home-'));
    tempDirs.push(homeDir);
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.GEMINI_CLI_HOME = '~/gemini-cli-home';

    vi.spyOn(console, 'log').mockImplementation(() => {});

    updateLocalGeminiCredentials({
      access_token: 'oauth-access-token',
      refresh_token: 'oauth-refresh-token',
    });

    const credentialsPath = join(homeDir, 'gemini-cli-home', '.gemini', 'oauth_creds.json');
    expect(JSON.parse(readFileSync(credentialsPath, 'utf8'))).toMatchObject({
      access_token: 'oauth-access-token',
      refresh_token: 'oauth-refresh-token',
      token_type: 'Bearer',
    });
  });
});
