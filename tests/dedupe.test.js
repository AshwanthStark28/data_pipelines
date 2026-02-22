const test = require('node:test');
const assert = require('node:assert/strict');

const { _internal } = require('../functions/notify');

test('buildDedupeKey prefers email_id when present', () => {
  const key = _internal.buildDedupeKey({
    email_id: '18f9f4f2',
    from: 'noreply@naukri.com',
    subject: 'Interview',
    date: '2026-01-01'
  });
  assert.equal(key, 'email:18f9f4f2');
});

test('buildDedupeKey hash is deterministic without email_id', () => {
  const payload = {
    from: 'hr@company.com',
    subject: 'Shortlisted',
    date: 'Sun, 01 Jan 2026 10:00:00 +0530',
    snippet: 'Invite for zoom call and assessment'
  };

  const first = _internal.buildDedupeKey(payload);
  const second = _internal.buildDedupeKey({ ...payload });

  assert.equal(first.startsWith('hash:'), true);
  assert.equal(first, second);
});
