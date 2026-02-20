#!/usr/bin/env python3
"""
Job Invite WhatsApp Agent

Polls Gmail for new emails, classifies job invites, and sends notifications to
WhatsApp through Twilio.
"""

from __future__ import annotations

import argparse
import base64
import email
import imaplib
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from email.header import decode_header
from typing import Iterable


STATE_FILE_DEFAULT = ".job_invite_agent_state.json"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_POLL_INTERVAL_SECONDS = 60

DEFAULT_KEYWORDS = [
    "job invite",
    "job opportunity",
    "career opportunity",
    "interview",
    "hiring",
    "recruiter",
    "application update",
    "screening call",
    "role match",
    "position open",
    "talent acquisition",
]


@dataclass
class AgentConfig:
    gmail_address: str
    gmail_app_password: str
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_from_whatsapp: str
    twilio_to_whatsapp: str
    keywords: list[str]
    poll_interval_seconds: int
    state_file: str
    bootstrap_skip_existing: bool
    dry_run: bool
    openai_api_key: str | None
    openai_model: str


@dataclass
class AgentState:
    last_uid: int
    initialized: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Monitor Gmail for job invite emails and send WhatsApp alerts via Twilio."
        )
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run only one polling cycle and exit.",
    )
    parser.add_argument(
        "--env-file",
        default=".env",
        help="Path to a .env file (default: .env).",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        help="Logging level (DEBUG, INFO, WARNING, ERROR). Default: INFO.",
    )
    return parser.parse_args()


def load_env_file(path: str) -> None:
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if (value.startswith('"') and value.endswith('"')) or (
                value.startswith("'") and value.endswith("'")
            ):
                value = value[1:-1]

            os.environ.setdefault(key, value)


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def read_config() -> AgentConfig:
    keywords = [
        token.strip().lower()
        for token in os.getenv("JOB_INVITE_KEYWORDS", ",".join(DEFAULT_KEYWORDS)).split(",")
        if token.strip()
    ]
    poll_interval_seconds = int(
        os.getenv("POLL_INTERVAL_SECONDS", str(DEFAULT_POLL_INTERVAL_SECONDS))
    )

    return AgentConfig(
        gmail_address=require_env("GMAIL_ADDRESS"),
        gmail_app_password=require_env("GMAIL_APP_PASSWORD"),
        twilio_account_sid=require_env("TWILIO_ACCOUNT_SID"),
        twilio_auth_token=require_env("TWILIO_AUTH_TOKEN"),
        twilio_from_whatsapp=require_env("TWILIO_FROM_WHATSAPP"),
        twilio_to_whatsapp=require_env("TWILIO_TO_WHATSAPP"),
        keywords=keywords,
        poll_interval_seconds=poll_interval_seconds,
        state_file=os.getenv("STATE_FILE", STATE_FILE_DEFAULT),
        bootstrap_skip_existing=env_bool("BOOTSTRAP_SKIP_EXISTING", True),
        dry_run=env_bool("DRY_RUN", False),
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        openai_model=os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL),
    )


def load_state(path: str) -> AgentState:
    if not os.path.exists(path):
        return AgentState(last_uid=0, initialized=False)

    with open(path, "r", encoding="utf-8") as state_file:
        data = json.load(state_file)

    return AgentState(
        last_uid=int(data.get("last_uid", 0)),
        initialized=bool(data.get("initialized", False)),
    )


def save_state(path: str, state: AgentState) -> None:
    payload = {
        "last_uid": state.last_uid,
        "initialized": state.initialized,
    }
    with open(path, "w", encoding="utf-8") as state_file:
        json.dump(payload, state_file, indent=2)


def decode_header_value(value: str) -> str:
    if not value:
        return ""
    fragments: list[str] = []
    for part, encoding in decode_header(value):
        if isinstance(part, bytes):
            fragments.append(part.decode(encoding or "utf-8", errors="replace"))
        else:
            fragments.append(part)
    return "".join(fragments)


def normalize_text(text: str) -> str:
    collapsed = re.sub(r"\s+", " ", text)
    return collapsed.strip()


def strip_html(text: str) -> str:
    no_scripts = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", text)
    no_tags = re.sub(r"(?is)<[^>]+>", " ", no_scripts)
    return normalize_text(no_tags)


def extract_text_from_message(message: email.message.Message) -> str:
    chunks: list[str] = []

    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            content_disposition = (part.get("Content-Disposition") or "").lower()
            if "attachment" in content_disposition:
                continue

            if content_type not in {"text/plain", "text/html"}:
                continue

            payload = part.get_payload(decode=True)
            if not payload:
                continue

            charset = part.get_content_charset() or "utf-8"
            decoded = payload.decode(charset, errors="replace")
            chunks.append(strip_html(decoded) if content_type == "text/html" else decoded)
    else:
        payload = message.get_payload(decode=True)
        if payload:
            charset = message.get_content_charset() or "utf-8"
            decoded = payload.decode(charset, errors="replace")
            if message.get_content_type() == "text/html":
                decoded = strip_html(decoded)
            chunks.append(decoded)

    return normalize_text(" ".join(chunks))


def imap_connect(config: AgentConfig) -> imaplib.IMAP4_SSL:
    client = imaplib.IMAP4_SSL("imap.gmail.com")
    client.login(config.gmail_address, config.gmail_app_password)
    status, _ = client.select("INBOX")
    if status != "OK":
        raise RuntimeError("Could not select INBOX.")
    return client


def fetch_new_uids(client: imaplib.IMAP4_SSL, last_uid: int) -> list[int]:
    status, data = client.uid("search", None, f"(UID {last_uid + 1}:*)")
    if status != "OK" or not data:
        return []

    raw = data[0].decode() if isinstance(data[0], bytes) else str(data[0])
    if not raw.strip():
        return []

    return sorted(int(uid) for uid in raw.split() if uid.isdigit() and int(uid) > last_uid)


def fetch_email_by_uid(client: imaplib.IMAP4_SSL, uid: int) -> dict[str, str]:
    status, data = client.uid("fetch", str(uid), "(BODY.PEEK[])")
    if status != "OK" or not data:
        raise RuntimeError(f"Failed to fetch email UID {uid}.")

    raw_message: bytes | None = None
    for item in data:
        if isinstance(item, tuple) and len(item) > 1:
            raw_message = item[1]
            break

    if raw_message is None:
        raise RuntimeError(f"No payload for email UID {uid}.")

    message = email.message_from_bytes(raw_message)
    subject = decode_header_value(message.get("Subject", ""))
    sender = decode_header_value(message.get("From", ""))
    date = decode_header_value(message.get("Date", ""))
    body = extract_text_from_message(message)

    return {
        "uid": str(uid),
        "subject": normalize_text(subject),
        "from": normalize_text(sender),
        "date": normalize_text(date),
        "body": body,
    }


def keyword_classifier(email_data: dict[str, str], keywords: Iterable[str]) -> tuple[bool, str]:
    searchable = " ".join(
        [email_data.get("subject", ""), email_data.get("from", ""), email_data.get("body", "")]
    ).lower()

    matched = [keyword for keyword in keywords if keyword in searchable]
    is_job_invite = len(matched) >= 2 or any(
        phrase in searchable
        for phrase in ["interview invitation", "we would like to interview", "application shortlisted"]
    )

    reason = "matched keywords: " + (", ".join(matched[:4]) if matched else "none")
    return is_job_invite, reason


def openai_classifier(config: AgentConfig, email_data: dict[str, str]) -> tuple[bool, str]:
    if not config.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured.")

    content_preview = email_data.get("body", "")[:2500]
    payload = {
        "model": config.openai_model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You classify if an email is a real job invite. Return strict JSON with keys: "
                    'is_job_invite (boolean), confidence (number between 0 and 1), reason (string).'
                ),
            },
            {
                "role": "user",
                "content": (
                    f"From: {email_data.get('from', '')}\n"
                    f"Subject: {email_data.get('subject', '')}\n"
                    f"Date: {email_data.get('date', '')}\n"
                    f"Body preview: {content_preview}"
                ),
            },
        ],
    }

    request = urllib.request.Request(
        url="https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.openai_api_key}",
        },
    )

    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read().decode("utf-8")
    parsed = json.loads(body)
    raw_content = (
        parsed.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    verdict = json.loads(raw_content) if raw_content else {}

    is_job_invite = bool(verdict.get("is_job_invite", False))
    confidence = verdict.get("confidence")
    reason = str(verdict.get("reason", "AI classification"))
    if confidence is not None:
        reason = f"{reason} (confidence={confidence})"
    return is_job_invite, reason


def classify_email(config: AgentConfig, email_data: dict[str, str]) -> tuple[bool, str]:
    if config.openai_api_key:
        try:
            return openai_classifier(config, email_data)
        except (urllib.error.URLError, json.JSONDecodeError, RuntimeError, KeyError) as exc:
            logging.warning("AI classifier failed, using keyword fallback: %s", exc)

    return keyword_classifier(email_data, config.keywords)


def format_whatsapp_message(email_data: dict[str, str], reason: str) -> str:
    preview = email_data.get("body", "")[:280]
    return (
        "New job invite detected!\n"
        f"From: {email_data.get('from', '(unknown)')}\n"
        f"Subject: {email_data.get('subject', '(no subject)')}\n"
        f"Date: {email_data.get('date', '(unknown)')}\n"
        f"Why: {reason}\n"
        f"Preview: {preview}"
    )


def send_whatsapp_via_twilio(config: AgentConfig, message_text: str) -> str:
    endpoint = (
        f"https://api.twilio.com/2010-04-01/Accounts/"
        f"{config.twilio_account_sid}/Messages.json"
    )
    data = urllib.parse.urlencode(
        {
            "From": config.twilio_from_whatsapp,
            "To": config.twilio_to_whatsapp,
            "Body": message_text,
        }
    ).encode("utf-8")

    token = base64.b64encode(
        f"{config.twilio_account_sid}:{config.twilio_auth_token}".encode("utf-8")
    ).decode("ascii")
    request = urllib.request.Request(
        endpoint,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Basic {token}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )

    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return str(payload.get("sid", ""))


def run_cycle(config: AgentConfig, state: AgentState) -> AgentState:
    client = imap_connect(config)
    try:
        new_uids = fetch_new_uids(client, state.last_uid)
        if not new_uids:
            logging.info("No new emails since UID %s.", state.last_uid)
            state.initialized = True
            return state

        if not state.initialized and config.bootstrap_skip_existing:
            state.last_uid = max(new_uids)
            state.initialized = True
            logging.info(
                "Bootstrap mode enabled: skipped %s existing emails, new baseline UID=%s.",
                len(new_uids),
                state.last_uid,
            )
            return state

        for uid in new_uids:
            email_data = fetch_email_by_uid(client, uid)
            is_invite, reason = classify_email(config, email_data)

            if is_invite:
                msg = format_whatsapp_message(email_data, reason)
                if config.dry_run:
                    logging.info("DRY_RUN enabled. Would send WhatsApp message:\n%s", msg)
                else:
                    sid = send_whatsapp_via_twilio(config, msg)
                    logging.info("WhatsApp notification sent for UID %s (sid=%s).", uid, sid)
            else:
                logging.info("UID %s not classified as job invite (%s).", uid, reason)

            state.last_uid = max(state.last_uid, uid)

        state.initialized = True
        return state
    finally:
        try:
            client.close()
        except Exception:
            pass
        client.logout()


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )

    load_env_file(args.env_file)
    try:
        config = read_config()
    except ValueError as exc:
        logging.error("%s", exc)
        return 2

    state = load_state(config.state_file)
    logging.info(
        "Agent started (poll=%ss, state_file=%s, ai_enabled=%s, dry_run=%s).",
        config.poll_interval_seconds,
        config.state_file,
        bool(config.openai_api_key),
        config.dry_run,
    )

    while True:
        try:
            state = run_cycle(config, state)
            save_state(config.state_file, state)
        except KeyboardInterrupt:
            logging.info("Received Ctrl+C, stopping.")
            return 0
        except Exception:
            logging.exception("Polling cycle failed.")

        if args.once:
            return 0

        time.sleep(config.poll_interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
