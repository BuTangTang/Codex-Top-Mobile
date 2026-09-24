// @ts-check

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTestflightDistributionEnvVarPrefix,
  resolveTestflightDistributionConfig,
} from './testflight-distribution-config.mjs';

test('testflight distribution config maps preview environment to APP_STORE_CONNECT_PREVIEW_* variables', () => {
  assert.equal(buildTestflightDistributionEnvVarPrefix('preview'), 'APP_STORE_CONNECT_PREVIEW');

  const config = resolveTestflightDistributionConfig({
    environment: 'preview',
    env: {
      APP_STORE_CONNECT_PREVIEW_EXTERNAL_GROUPS: 'preview-group-id',
      APP_STORE_CONNECT_PREVIEW_SUBMIT_BETA_REVIEW: 'false',
      APP_STORE_CONNECT_PREVIEW_WAIT_PROCESSING: 'false',
      APP_STORE_CONNECT_PREVIEW_PROCESSING_TIMEOUT_SECONDS: '120',
    },
  });

  assert.equal(config.enabled, true);
  assert.equal(config.externalGroups, 'preview-group-id');
  assert.equal(config.submitBetaReview, 'false');
  assert.equal(config.waitProcessing, false);
  assert.equal(config.processingTimeoutSeconds, 120);
});

test('testflight distribution config maps dev lane to APP_STORE_CONNECT_PUBLICDEV_* variables through the normalized environment id', () => {
  assert.equal(buildTestflightDistributionEnvVarPrefix('publicdev'), 'APP_STORE_CONNECT_PUBLICDEV');

  const config = resolveTestflightDistributionConfig({
    environment: 'publicdev',
    env: {
      APP_STORE_CONNECT_PUBLICDEV_EXTERNAL_GROUPS: 'dev-group-id',
    },
  });

  assert.equal(config.enabled, true);
  assert.equal(config.externalGroups, 'dev-group-id');
  assert.equal(config.submitBetaReview, 'auto');
  assert.equal(config.waitProcessing, true);
  assert.equal(config.processingTimeoutSeconds, 3600);
});
