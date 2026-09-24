// @ts-check

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

import { readIosIpaMetadata } from './read-ios-ipa-metadata.mjs';

test('readIosIpaMetadata reads version and build number from an IPA fixture', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'happier-read-ios-ipa-metadata-'));
  const ipaPath = path.join(tmpDir, 'app.ipa');

  const pythonScript = [
    'import sys, zipfile',
    'ipa_path = sys.argv[1]',
    'bundle_id = sys.argv[2]',
    'plist = f"""<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '<key>CFBundleIdentifier</key><string>{bundle_id}</string>',
    '<key>CFBundleDisplayName</key><string>Happier (preview)</string>',
    '<key>CFBundleShortVersionString</key><string>0.1.0</string>',
    '<key>CFBundleVersion</key><string>48</string>',
    '</dict></plist>"""',
    'with zipfile.ZipFile(ipa_path, "w") as z:',
    '  z.writestr("Payload/Happierpreview.app/Info.plist", plist)',
  ].join('\n');

  execFileSync('python3', ['-c', pythonScript, ipaPath, 'dev.happier.app.preview'], {
    cwd: tmpDir,
    stdio: 'ignore',
    timeout: 30_000,
  });

  const metadata = readIosIpaMetadata({
    ipaPath,
    env: { ...process.env },
  });

  assert.deepEqual(metadata, {
    bundleIdentifier: 'dev.happier.app.preview',
    displayName: 'Happier (preview)',
    version: '0.1.0',
    buildNumber: '48',
  });
});
