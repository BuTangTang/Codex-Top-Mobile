import { describe, expect, it } from 'vitest';

import { HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY } from '../connectedServiceChildEnvironment';
import { resolveConnectedServiceRuntimeAuthRecoverySelection } from './resolveConnectedServiceRuntimeAuthRecoverySelection';
import type { ConnectedServiceRuntimeFailureClassification } from './types';

const baseClassification: ConnectedServiceRuntimeFailureClassification = {
  kind: 'usage_limit',
  limitCategory: 'usage_limit',
  serviceId: 'openai-codex',
  profileId: null,
  groupId: null,
  retryAfterMs: null,
  resetsAtMs: null,
  quotaScope: undefined,
  providerLimitId: null,
  action: null,
  planType: null,
  rateLimits: null,
  source: 'structured_provider_error',
};

function bindings(profileId: string) {
  return {
    v: 1,
    bindingsByServiceId: {
      'openai-codex': {
        source: 'connected',
        selection: 'group',
        profileId,
        groupId: 'main',
      },
    },
  };
}

describe('resolveConnectedServiceRuntimeAuthRecoverySelection', () => {
  it('uses a complete internally consistent runtime report before stale child env or metadata', () => {
    expect(resolveConnectedServiceRuntimeAuthRecoverySelection({
      classification: {
        ...baseClassification,
        profileId: 'reported-profile',
        groupId: 'reported-group',
      },
      environmentVariables: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'stale-env-group',
          activeProfileId: 'stale-env-profile',
          fallbackProfileId: 'stale-env-profile',
          generation: 3,
        }]),
      },
      trackedConnectedServices: bindings('tracked-profile'),
      sessionMetadataConnectedServices: bindings('metadata-profile'),
    })).toEqual({
      source: 'classification',
      selection: {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'reported-group',
        fallbackProfileId: 'reported-profile',
      },
    });
  });

  it('uses child-env selection before tracked and metadata bindings', () => {
    expect(resolveConnectedServiceRuntimeAuthRecoverySelection({
      classification: baseClassification,
      environmentVariables: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'main',
          activeProfileId: 'env-profile',
          fallbackProfileId: 'env-profile',
          generation: 3,
        }]),
      },
      trackedConnectedServices: bindings('tracked-profile'),
      sessionMetadataConnectedServices: bindings('metadata-profile'),
    })).toEqual({
      source: 'child_env',
      selection: {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'main',
        activeProfileId: 'env-profile',
        fallbackProfileId: 'env-profile',
      },
    });
  });

  it('falls back to durable session metadata before trusting an incomplete runtime report', () => {
    expect(resolveConnectedServiceRuntimeAuthRecoverySelection({
      classification: baseClassification,
      sessionMetadataConnectedServices: bindings('metadata-profile'),
    })).toEqual({
      source: 'session_metadata',
      selection: {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'main',
        fallbackProfileId: 'metadata-profile',
      },
    });
  });

  it('uses durable group binding when the runtime report identifies only the failed profile', () => {
    expect(resolveConnectedServiceRuntimeAuthRecoverySelection({
      classification: {
        ...baseClassification,
        profileId: 'reported-profile',
        groupId: null,
      },
      trackedConnectedServices: bindings('tracked-profile'),
      sessionMetadataConnectedServices: bindings('metadata-profile'),
    })).toEqual({
      source: 'tracked_spawn_options',
      selection: {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'main',
        fallbackProfileId: 'reported-profile',
      },
    });
  });

  it('uses the runtime report only after durable sources fail to identify the binding', () => {
    expect(resolveConnectedServiceRuntimeAuthRecoverySelection({
      classification: {
        ...baseClassification,
        profileId: 'reported-profile',
        groupId: 'reported-group',
      },
    })).toEqual({
      source: 'classification',
      selection: {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'reported-group',
        fallbackProfileId: 'reported-profile',
      },
    });
  });
});
