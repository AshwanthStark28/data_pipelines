# Job Invite WhatsApp AI Agent

This project provides an automated agent that:

1. Checks your Gmail inbox for newly received emails.
2. Classifies whether each email is a **job invite** (AI-based or keyword fallback).
3. Sends a WhatsApp notification for each detected invite using Twilio WhatsApp.

## How it works

- Connects to Gmail over IMAP (`imap.gmail.com`).
- Tracks the last processed Gmail UID in a local state file.
- On first run, it can skip existing old emails (`BOOTSTRAP_SKIP_EXISTING=true`) to avoid spam alerts.
- Uses OpenAI classification if `OPENAI_API_KEY` is set.
- Falls back to keyword matching if AI is not configured or unavailable.

## Files

- `job_invite_whatsapp_agent.py` - main agent
- `.env.example` - environment configuration template

## Prerequisites

- Python 3.10+
- Gmail account with:
  - 2-Step Verification enabled
  - App Password generated for IMAP
- Twilio account with WhatsApp capability (Sandbox is fine for testing)

## Setup

### 1) Configure Gmail

1. Enable 2-Step Verification on your Google account.
2. Create an **App Password** for Mail.
3. Use that app password in `GMAIL_APP_PASSWORD`.

### 2) Configure Twilio WhatsApp

1. In Twilio Console, open WhatsApp Sandbox.
2. Join the sandbox from your phone (send the join code from WhatsApp).
3. Copy:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - sandbox sender number (usually `whatsapp:+14155238886`)
4. Set your phone number as `TWILIO_TO_WHATSAPP` (e.g. `whatsapp:+12345678900`).

### 3) Configure environment

Copy the example file and edit values:

```bash
cp .env.example .env
```

Required variables:

- `GMAIL_ADDRESS`
- `GMAIL_APP_PASSWORD`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_WHATSAPP`
- `TWILIO_TO_WHATSAPP`

Optional variables:

- `OPENAI_API_KEY` and `OPENAI_MODEL` (enables AI classification)
- `POLL_INTERVAL_SECONDS` (default: `60`)
- `BOOTSTRAP_SKIP_EXISTING` (default: `true`)
- `DRY_RUN` (default: `false`)
- `STATE_FILE` (default: `.job_invite_agent_state.json`)
- `JOB_INVITE_KEYWORDS` (comma-separated list)

## Run

Single cycle test:

```bash
python3 job_invite_whatsapp_agent.py --once
```

Continuous monitoring:

```bash
python3 job_invite_whatsapp_agent.py
```

Use dry-run mode (no WhatsApp send):

```bash
DRY_RUN=true python3 job_invite_whatsapp_agent.py --once
```

## Notes

- Keep `.env` private and never commit real credentials.
- Gmail IMAP access can be restricted by account security policies.
- Twilio trial/sandbox may enforce recipient and sender restrictions.
