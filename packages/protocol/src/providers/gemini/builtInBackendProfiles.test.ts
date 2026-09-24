import { describe, expect, it } from 'vitest';

import { GEMINI_BUILT_IN_BACKEND_PROFILES } from './builtInBackendProfiles.js';

describe('Gemini built-in backend profiles', () => {
  it('does not pin GEMINI_MODEL in API-key or Vertex profiles', () => {
    const profiles = GEMINI_BUILT_IN_BACKEND_PROFILES.filter((profile) =>
      profile.id === 'gemini-api-key' || profile.id === 'gemini-vertex'
    );

    expect(profiles).toHaveLength(2);
    for (const profile of profiles) {
      expect(profile.environmentVariables?.some((entry) => entry.name === 'GEMINI_MODEL')).toBe(false);
    }
  });
});
