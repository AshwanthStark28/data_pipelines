const test = require('node:test');
const assert = require('node:assert/strict');

const { _internal } = require('../functions/notify');

test('scorePayload counts keyword hits from subject/snippet/body', () => {
  const payload = {
    subject: 'Interview invite from recruiter on Naukri',
    snippet: 'Please schedule a zoom call and selection process discussion',
    body: 'HR shared date and time for assessment'
  };

  const result = _internal.scorePayload(payload);
  assert.equal(result.score >= 8, true);
  assert.equal(result.matched.includes('interview'), true);
  assert.equal(result.matched.includes('zoom'), true);
  assert.equal(result.matched.includes('assessment'), true);
});

test('getDetectorThreshold falls back to default when invalid', () => {
  assert.equal(_internal.getDetectorThreshold(undefined), 3);
  assert.equal(_internal.getDetectorThreshold('abc'), 3);
  assert.equal(_internal.getDetectorThreshold('0'), 3);
  assert.equal(_internal.getDetectorThreshold('5'), 5);
});
