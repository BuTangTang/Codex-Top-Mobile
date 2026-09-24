import { afterEach, describe, expect, it } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { writeExecutableShimSync } from '@/testkit/fs/executableShim';
import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';

import { cursorCliAuthSpec } from './cursorCliAuthSpec';

const envKeys = [
  'CURSOR_API_KEY',
  'HAPPIER_CURSOR_AGENT_FALLBACK_ENABLED',
  'HAPPIER_CURSOR_CLI_AUTH_PROBE_TIMEOUT_MS',
] as const;
const tempDirs = new Set<string>();
let envScope = createEnvKeyScope(envKeys);

function createFakeCursorAgent(contents: string): string {
  const dir = createTempDirSync('happier-cursor-auth-');
  tempDirs.add(dir);
  return writeExecutableShimSync({
    dir,
    fileName: process.platform === 'win32' ? 'cursor-agent.cmd' : 'cursor-agent',
    contents,
  });
}

afterEach(() => {
  envScope.restore();
  envScope = createEnvKeyScope(envKeys);
  for (const dir of tempDirs) removeTempDirSync(dir);
  tempDirs.clear();
});

describe('cursorCliAuthSpec', () => {
  it('honors the Cursor agent fallback toggle when resolving auth binary names', () => {
    envScope.patch({
      HAPPIER_CURSOR_AGENT_FALLBACK_ENABLED: '0',
    });

    expect(cursorCliAuthSpec.binaryNames).toEqual(['cursor-agent']);

    envScope.patch({
      HAPPIER_CURSOR_AGENT_FALLBACK_ENABLED: '1',
    });

    expect(cursorCliAuthSpec.binaryNames).toEqual(['cursor-agent', 'agent']);
  });

  it('reports logged in from Cursor about JSON output', async () => {
    const resolvedPath = createFakeCursorAgent(process.platform === 'win32'
      ? '@echo off\r\nif "%1"=="about" if "%2"=="--format" if "%3"=="json" (\r\n  echo {"email":"alice@example.test","subscriptionTier":"pro"}\r\n  exit /b 0\r\n)\r\nexit /b 1\r\n'
      : '#!/bin/sh\nif [ "$1" = "about" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then\n  echo \'{"email":"alice@example.test","subscriptionTier":"pro"}\'\n  exit 0\nfi\nexit 1\n');

    const detectAuthStatus = cursorCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');
    if (!detectAuthStatus) throw new Error('cursorCliAuthSpec.detectAuthStatus must be defined for this test');

    await expect(detectAuthStatus({ resolvedPath })).resolves.toMatchObject({
      state: 'logged_in',
      method: 'oauth_cli',
      accountLabel: 'alice@example.test',
      source: 'command',
    });
  });

  it('uses Cursor status JSON when about JSON has no auth signal', async () => {
    const resolvedPath = createFakeCursorAgent(process.platform === 'win32'
      ? '@echo off\r\nif "%1"=="about" if "%2"=="--format" if "%3"=="json" (\r\n  echo {"version":"1.2.3"}\r\n  exit /b 0\r\n)\r\nif "%1"=="status" if "%2"=="--format" if "%3"=="json" (\r\n  echo {"status":"authenticated","isAuthenticated":true,"hasAccessToken":true,"hasRefreshToken":true,"userInfo":{"email":"status@example.test"}}\r\n  exit /b 0\r\n)\r\nexit /b 1\r\n'
      : '#!/bin/sh\nif [ "$1" = "about" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then\n  echo \'{"version":"1.2.3"}\'\n  exit 0\nfi\nif [ "$1" = "status" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then\n  echo \'{"status":"authenticated","isAuthenticated":true,"hasAccessToken":true,"hasRefreshToken":true,"userInfo":{"email":"status@example.test"}}\'\n  exit 0\nfi\nexit 1\n');

    const detectAuthStatus = cursorCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');
    if (!detectAuthStatus) throw new Error('cursorCliAuthSpec.detectAuthStatus must be defined for this test');

    await expect(detectAuthStatus({ resolvedPath })).resolves.toMatchObject({
      state: 'logged_in',
      method: 'oauth_cli',
      accountLabel: 'status@example.test',
      source: 'command',
    });
  });

  it('honors an explicit logged-out about JSON state over stale user labels', async () => {
    const resolvedPath = createFakeCursorAgent(process.platform === 'win32'
      ? '@echo off\r\nif "%1"=="about" if "%2"=="--format" if "%3"=="json" (\r\n  echo {"isAuthenticated":false,"hasAccessToken":false,"hasRefreshToken":false,"userInfo":{"email":"stale@example.test"}}\r\n  exit /b 0\r\n)\r\nexit /b 1\r\n'
      : '#!/bin/sh\nif [ "$1" = "about" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then\n  echo \'{"isAuthenticated":false,"hasAccessToken":false,"hasRefreshToken":false,"userInfo":{"email":"stale@example.test"}}\'\n  exit 0\nfi\nexit 1\n');

    const detectAuthStatus = cursorCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');
    if (!detectAuthStatus) throw new Error('cursorCliAuthSpec.detectAuthStatus must be defined for this test');

    await expect(detectAuthStatus({ resolvedPath })).resolves.toMatchObject({
      state: 'logged_out',
      reason: 'missing_credentials',
      source: 'command',
    });
  });

  it('treats unauthenticated Cursor status JSON as logged out', async () => {
    const resolvedPath = createFakeCursorAgent(process.platform === 'win32'
      ? '@echo off\r\nif "%1"=="about" if "%2"=="--format" if "%3"=="json" (\r\n  echo {"version":"1.2.3"}\r\n  exit /b 0\r\n)\r\nif "%1"=="status" if "%2"=="--format" if "%3"=="json" (\r\n  echo {"status":"not_authenticated","isAuthenticated":false,"hasAccessToken":false,"hasRefreshToken":false,"userInfo":{"email":"stale@example.test"}}\r\n  exit /b 0\r\n)\r\nexit /b 1\r\n'
      : '#!/bin/sh\nif [ "$1" = "about" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then\n  echo \'{"version":"1.2.3"}\'\n  exit 0\nfi\nif [ "$1" = "status" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then\n  echo \'{"status":"not_authenticated","isAuthenticated":false,"hasAccessToken":false,"hasRefreshToken":false,"userInfo":{"email":"stale@example.test"}}\'\n  exit 0\nfi\nexit 1\n');

    const detectAuthStatus = cursorCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');
    if (!detectAuthStatus) throw new Error('cursorCliAuthSpec.detectAuthStatus must be defined for this test');

    await expect(detectAuthStatus({ resolvedPath })).resolves.toMatchObject({
      state: 'logged_out',
      reason: 'missing_credentials',
      source: 'command',
    });
  });

  it('falls back to plain Cursor about output when --format json is unsupported', async () => {
    const resolvedPath = createFakeCursorAgent(process.platform === 'win32'
      ? '@echo off\r\nif "%1"=="about" if "%2"=="--format" if "%3"=="json" (\r\n  echo error: unknown option --format 1>&2\r\n  exit /b 2\r\n)\r\nif "%1"=="about" (\r\n  echo Logged in as bob@example.test\r\n  exit /b 0\r\n)\r\nexit /b 1\r\n'
      : '#!/bin/sh\nif [ "$1" = "about" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then\n  echo "error: unknown option --format" >&2\n  exit 2\nfi\nif [ "$1" = "about" ]; then\n  echo "Logged in as bob@example.test"\n  exit 0\nfi\nexit 1\n');

    const detectAuthStatus = cursorCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');
    if (!detectAuthStatus) throw new Error('cursorCliAuthSpec.detectAuthStatus must be defined for this test');

    await expect(detectAuthStatus({ resolvedPath })).resolves.toMatchObject({
      state: 'logged_in',
      method: 'oauth_cli',
      accountLabel: 'bob@example.test',
      source: 'command',
    });
  });

  it('reports unsupported when Cursor rejects --format and plain about has no auth signal', async () => {
    const resolvedPath = createFakeCursorAgent(process.platform === 'win32'
      ? '@echo off\r\nif "%1"=="about" if "%2"=="--format" if "%3"=="json" (\r\n  echo error: unknown option --format 1>&2\r\n  exit /b 2\r\n)\r\nif "%1"=="about" (\r\n  echo Cursor Agent\r\n  exit /b 0\r\n)\r\nexit /b 1\r\n'
      : '#!/bin/sh\nif [ "$1" = "about" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then\n  echo "error: unknown option --format" >&2\n  exit 2\nfi\nif [ "$1" = "about" ]; then\n  echo "Cursor Agent"\n  exit 0\nfi\nexit 1\n');

    const detectAuthStatus = cursorCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');
    if (!detectAuthStatus) throw new Error('cursorCliAuthSpec.detectAuthStatus must be defined for this test');

    await expect(detectAuthStatus({ resolvedPath })).resolves.toMatchObject({
      state: 'unknown',
      reason: 'unsupported',
      source: 'command',
    });
  });

  it('reports unknown when Cursor commands fail without an auth signal', async () => {
    const resolvedPath = createFakeCursorAgent(process.platform === 'win32'
      ? '@echo off\r\nif "%1"=="about" if "%2"=="--format" if "%3"=="json" (\r\n  echo Cursor internal error 1>&2\r\n  exit /b 1\r\n)\r\nif "%1"=="status" if "%2"=="--format" if "%3"=="json" (\r\n  echo Cursor internal error 1>&2\r\n  exit /b 1\r\n)\r\nexit /b 1\r\n'
      : '#!/bin/sh\nif [ "$1" = "about" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then\n  echo "Cursor internal error" >&2\n  exit 1\nfi\nif [ "$1" = "status" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then\n  echo "Cursor internal error" >&2\n  exit 1\nfi\nexit 1\n');

    const detectAuthStatus = cursorCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');
    if (!detectAuthStatus) throw new Error('cursorCliAuthSpec.detectAuthStatus must be defined for this test');

    await expect(detectAuthStatus({ resolvedPath })).resolves.toMatchObject({
      state: 'unknown',
      reason: 'probe_failed',
      source: 'command',
    });
  });
});
