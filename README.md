# whatsapp-naukri-zapier-twilio

## Simple healthcare dashboard

A clean, lightweight healthcare dashboard is available at:

- `dashboard/index.html`

It is fully static (HTML/CSS/JS), so you can open it directly in a browser or run a local server:

```bash
python3 -m http.server 4173
```

Then open:

- `http://localhost:4173/dashboard/`

---

Minimal GitHub-ready project:

**Zapier (Gmail trigger) -> Webhook POST -> Twilio Serverless Function -> WhatsApp**

No always-on server required.

---

## 1) What this does

`/functions/notify.js` receives a Zapier POST payload, then:

1. Validates `X-Webhook-Secret` header against `WEBHOOK_SECRET`.
2. Runs keyword score detection on `subject + snippet + body`.
3. Dedupes via Twilio Sync for 24h.
4. Sends WhatsApp message via Twilio API (with one retry on transient errors).

If unauthorized: returns `401 { ok:false, error:"unauthorized" }` and sends nothing.

If below threshold: returns `200 { ok:true, action:"ignored", score:n }`.

If duplicate: returns `200 { ok:true, action:"deduped" }`.

If sent: returns `200 { ok:true, action:"sent", sid:"SM..." }`.

---

## 2) Project files

- `functions/notify.js` - Twilio Function (auth, detection, dedupe, send, retry)
- `.env.example` - environment variable template
- `.gitignore`
- `tests/*.test.js` - minimal unit tests (detector + dedupe key)
- `package.json`

---

## 3) Twilio WhatsApp Sandbox setup

1. Open **Twilio Console -> Messaging -> Try it out -> Send a WhatsApp message**.
2. From your phone, send the join message shown by Twilio, e.g.:
   - `join <code>`
3. Confirm your phone is joined to sandbox.
4. Use sandbox sender in env:
   - `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`

---

## 4) Install Twilio CLI + Serverless plugin

```bash
npm install
npm install -g twilio-cli
twilio plugins:install @twilio-labs/plugin-serverless
twilio login
```

---

## 5) Configure environment variables for deploy

Copy and edit:

```bash
cp .env.example .env
```

Set these values in `.env`:

- `WEBHOOK_SECRET` (long random string)
- `DETECTOR_THRESHOLD` (default `3`)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`
- `TWILIO_WHATSAPP_TO`
- optional: `TWILIO_SYNC_SERVICE_SID`

---

## 6) Deploy Twilio Function

```bash
twilio serverless:deploy
```

After deploy, note your Function URL for `/notify`, for example:

`https://your-service-xxxx-dev.twil.io/notify`

---

## 7) Zapier setup

### Trigger

- App: **Gmail**
- Event: **New Email Matching Search**

Use one of these Gmail queries (pick one and tune as needed):

1. `from:(naukri.com) (interview OR shortlisted OR assessment OR recruiter OR "selection process" OR invite)`
2. `(subject:(naukri OR interview OR shortlisted) OR from:(naukri.com jobs@naukri.com))`
3. `(naukri OR "naukri.com") (interview OR schedule OR assessment OR recruiter OR hr OR invite OR "google meet" OR zoom)`

### Action

- App: **Webhooks by Zapier**
- Event: **POST**
- URL: `https://.../notify`
- Payload type: `json`

Headers:

- `X-Webhook-Secret: <same as WEBHOOK_SECRET>`

Body mapping (Zap fields -> JSON keys):

- `email_id` -> Gmail Message ID (if available)
- `subject` -> Subject
- `from` -> From
- `date` -> Date
- `snippet` -> Snippet
- `body` -> Plain Body (if available)
- `source` -> optional static value like `Gmail/Naukri`

Expected payload shape:

```json
{
  "email_id": "optional",
  "subject": "string",
  "from": "string",
  "date": "string",
  "snippet": "optional",
  "body": "optional",
  "source": "optional"
}
```

---

## 8) End-to-end test

1. Ensure your phone has joined Twilio WhatsApp sandbox.
2. Deploy function and copy `/notify` URL.
3. In Zapier webhook action, click **Test** with sample Gmail data containing Naukri keywords.
4. Confirm:
   - Function response is `action:"sent"` and has `sid`
   - WhatsApp arrives on your phone
5. Trigger again with same `email_id` and confirm `action:"deduped"`.
6. Test with non-matching content and confirm `action:"ignored"`.

---

## 9) Troubleshooting

- **401 unauthorized**
  - `X-Webhook-Secret` header missing or mismatched.
  - `WEBHOOK_SECRET` not set correctly in deploy env.

- **No WhatsApp sent, action ignored**
  - Score below `DETECTOR_THRESHOLD`.
  - Reduce threshold or include more keywords in Gmail/Zap test sample.

- **No WhatsApp sent, action deduped**
  - Same `email_id` or equivalent hashed content seen within 24h.

- **500 missing_env**
  - One or more Twilio vars are not set.

- **500 internal_error**
  - Check Twilio Function logs:
    - `twilio serverless:logs --tail`

---

## 10) Exact terminal commands

### Required run commands

```bash
npm install
twilio login
twilio serverless:deploy
```

### GitHub push commands (as requested)

```bash
git init
git add .
git commit -m "Initial commit: Zapier->Twilio WhatsApp Naukri notifier"
gh repo create whatsapp-naukri-zapier-twilio --public --source=. --remote=origin --push
```

### Manual remote add + push (if `gh` is not installed)

```bash
git init
git add .
git commit -m "Initial commit: Zapier->Twilio WhatsApp Naukri notifier"
git remote add origin https://github.com/<your-username>/whatsapp-naukri-zapier-twilio.git
git branch -M main
git push -u origin main
```
