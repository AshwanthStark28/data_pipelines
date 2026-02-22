const crypto = require('node:crypto');
const twilio = require('twilio');

const KEYWORDS = [
  'interview',
  'shortlisted',
  'schedule',
  'assessment',
  'recruiter',
  'hr',
  'selection process',
  'invite',
  'naukri',
  'naukri.com',
  'call',
  'zoom',
  'google meet',
  'date',
  'time'
];

const DEFAULT_SOURCE = 'Gmail/Naukri';
const DEFAULT_THRESHOLD = 3;
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;
const SYNC_SERVICE_NAME = 'whatsapp-naukri-zapier-twilio';
const SEND_RETRY_DELAY_MS = 800;

let cachedSyncServiceSid = null;

function cleanString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function clip(value, maxLength) {
  const text = cleanString(value);
  if (!text) {
    return '';
  }
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function getHeader(headers, headerName) {
  if (!headers || typeof headers !== 'object') {
    return '';
  }
  const wanted = headerName.toLowerCase();
  for (const [key, rawValue] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) {
      continue;
    }
    if (Array.isArray(rawValue)) {
      return cleanString(rawValue[0]);
    }
    return cleanString(rawValue);
  }
  return '';
}

function isAuthorizedRequest(event, expectedSecret) {
  const secret = cleanString(expectedSecret);
  if (!secret) {
    console.error('WEBHOOK_SECRET is not configured.');
    return false;
  }
  const provided = getHeader(event?.request?.headers || event?.headers, 'x-webhook-secret');
  return provided === secret;
}

function parsePayload(event) {
  const payload = (event?.payload && typeof event.payload === 'object') ? event.payload : event;
  return {
    email_id: cleanString(payload?.email_id || payload?.emailId || payload?.message_id),
    subject: cleanString(payload?.subject),
    from: cleanString(payload?.from),
    date: cleanString(payload?.date),
    snippet: cleanString(payload?.snippet),
    body: cleanString(payload?.body),
    source: cleanString(payload?.source) || DEFAULT_SOURCE
  };
}

function getDetectorThreshold(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_THRESHOLD;
  }
  return parsed;
}

function scorePayload(payload) {
  const text = `${payload.subject} ${payload.snippet} ${payload.body}`.toLowerCase();
  let score = 0;
  const matched = [];
  for (const keyword of KEYWORDS) {
    if (text.includes(keyword)) {
      score += 1;
      matched.push(keyword);
    }
  }
  return { score, matched };
}

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildDedupeKey(payload) {
  if (payload.email_id) {
    return `email:${payload.email_id}`;
  }
  const excerptForHash = clip(payload.snippet || payload.body, 200);
  const base = [payload.from, payload.subject, payload.date, excerptForHash]
    .map((item) => cleanString(item).toLowerCase())
    .join('|');
  return `hash:${hashText(base)}`;
}

function buildWhatsAppBody(payload) {
  const excerpt = clip(payload.snippet || payload.body, 300);
  const lines = [
    'Naukri Invite ✅',
    `Subject: ${payload.subject || '(no subject)'}`,
    `From: ${payload.from || '(unknown sender)'}`,
    `Date: ${payload.date || '(unknown date)'}`,
    `Excerpt: ${excerpt || '(no excerpt)'}`
  ];
  return lines.join('\n');
}

function createJsonResponse(statusCode, bodyObj) {
  if (typeof Twilio !== 'undefined' && Twilio.Response) {
    const response = new Twilio.Response();
    response.setStatusCode(statusCode);
    response.appendHeader('Content-Type', 'application/json');
    response.appendHeader('Cache-Control', 'no-store');
    response.setBody(JSON.stringify(bodyObj));
    return response;
  }
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(bodyObj)
  };
}

function isTransientError(error) {
  const statusCode = Number(error?.status || error?.statusCode);
  return statusCode === 429 || (statusCode >= 500 && statusCode < 600);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(client, params) {
  try {
    return await client.messages.create(params);
  } catch (error) {
    if (!isTransientError(error)) {
      throw error;
    }
    await sleep(SEND_RETRY_DELAY_MS);
    return client.messages.create(params);
  }
}

async function resolveSyncServiceSid(client, context) {
  const provided = cleanString(context.TWILIO_SYNC_SERVICE_SID);
  if (provided) {
    return provided;
  }
  if (cachedSyncServiceSid) {
    return cachedSyncServiceSid;
  }

  const services = await client.sync.v1.services.list({ limit: 20 });
  const match = services.find((svc) => svc.friendlyName === SYNC_SERVICE_NAME);
  if (match) {
    cachedSyncServiceSid = match.sid;
    return match.sid;
  }
  if (services.length > 0) {
    cachedSyncServiceSid = services[0].sid;
    return services[0].sid;
  }

  const created = await client.sync.v1.services.create({
    friendlyName: SYNC_SERVICE_NAME
  });
  cachedSyncServiceSid = created.sid;
  return created.sid;
}

async function markAsProcessedIfNew(client, context, dedupeKey) {
  const serviceSid = await resolveSyncServiceSid(client, context);
  const documents = client.sync.v1.services(serviceSid).documents;

  try {
    await documents(dedupeKey).fetch();
    return false;
  } catch (error) {
    if (Number(error?.status) !== 404) {
      throw error;
    }
  }

  try {
    await documents.create({
      uniqueName: dedupeKey,
      data: { createdAt: new Date().toISOString() },
      ttl: DEDUPE_TTL_SECONDS
    });
    return true;
  } catch (error) {
    if (Number(error?.status) === 409) {
      return false;
    }
    throw error;
  }
}

function assertSendConfig(context) {
  const requiredVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_WHATSAPP_FROM',
    'TWILIO_WHATSAPP_TO'
  ];
  const missing = requiredVars.filter((key) => !cleanString(context[key]));
  return {
    ok: missing.length === 0,
    missing
  };
}

exports.handler = async function handler(context, event, callback) {
  try {
    if (!isAuthorizedRequest(event, context.WEBHOOK_SECRET)) {
      return callback(null, createJsonResponse(401, { ok: false, error: 'unauthorized' }));
    }

    const payload = parsePayload(event);
    const threshold = getDetectorThreshold(context.DETECTOR_THRESHOLD);
    const { score } = scorePayload(payload);

    if (score < threshold) {
      return callback(null, createJsonResponse(200, { ok: true, action: 'ignored', score }));
    }

    const configState = assertSendConfig(context);
    if (!configState.ok) {
      console.error('Missing required env vars:', configState.missing.join(', '));
      return callback(null, createJsonResponse(500, { ok: false, error: 'missing_env' }));
    }

    const client = twilio(context.TWILIO_ACCOUNT_SID, context.TWILIO_AUTH_TOKEN);
    const dedupeKey = buildDedupeKey(payload);
    const isNew = await markAsProcessedIfNew(client, context, dedupeKey);

    if (!isNew) {
      return callback(null, createJsonResponse(200, { ok: true, action: 'deduped' }));
    }

    const message = await sendWithRetry(client, {
      from: context.TWILIO_WHATSAPP_FROM,
      to: context.TWILIO_WHATSAPP_TO,
      body: buildWhatsAppBody(payload)
    });

    return callback(null, createJsonResponse(200, { ok: true, action: 'sent', sid: message.sid }));
  } catch (error) {
    console.error('notify handler error:', error.message, error.stack);
    return callback(null, createJsonResponse(500, { ok: false, error: 'internal_error' }));
  }
};

exports._internal = {
  KEYWORDS,
  DEFAULT_SOURCE,
  DEFAULT_THRESHOLD,
  cleanString,
  clip,
  parsePayload,
  getDetectorThreshold,
  scorePayload,
  hashText,
  buildDedupeKey,
  buildWhatsAppBody,
  isTransientError
};
