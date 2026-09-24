import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAscBuildsListUrl } from './testflight-asc-builds-url.mjs';

test('buildAscBuildsListUrl uses the ASC builds collection with filter[app] so include relationships are allowed', () => {
  const url = buildAscBuildsListUrl({ ascAppId: '6761304097', limit: 200 });

  assert.equal(
    url,
    'https://api.appstoreconnect.apple.com/v1/builds?filter%5Bapp%5D=6761304097&include=preReleaseVersion%2CbetaGroups%2CbetaAppReviewSubmission&limit=200',
  );
});
