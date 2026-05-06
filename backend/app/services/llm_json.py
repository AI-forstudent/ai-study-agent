"""
app/services/llm_json.py
─────────────────────────
Robust "LLM-must-return-JSON" helpers.

The pipeline of every JSON-extracting feature (syllabus, exam questions,
transcript parsing) used to be:

    raw = ask_gemini(prompt)
    cleaned = raw.strip().lstrip("```json").rstrip("```")
    parsed = json.loads(cleaned)   # ← blew up with "char 0" on empty

…and `ask_gemini` itself swallows exceptions and returns a Hebrew apology
string when the API errors, so JSON callers got "מצטער..." back and tried
to parse it as JSON.

This module centralises the parse + retry path so every LLM JSON consumer
gets the same well-behaved, well-logged behaviour:

  • `safe_json_parse(raw)`         — strips whitespace, fences, prose
                                     preambles; tolerant of all the weird
                                     things models do.
  • `call_llm_for_json(...)`       — N-attempt retry loop with progressively
                                     stricter "JSON only, no markdown"
                                     reminders appended to the base prompt.
  • `LLMJsonError`                 — single exception type the routers map
                                     to a user-friendly 502.

Use this module ANYTIME you need an LLM to produce JSON. Do not call
`json.loads` on raw LLM output anywhere else.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable, Type


log = logging.getLogger(__name__)

# ── Regex helpers ─────────────────────────────────────────────────────────
# Match ```json ... ``` or ``` ... ``` blocks anywhere in the response.
# Greedy but non-overlapping so we grab the first complete fenced block.
_FENCE_PATTERN = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.MULTILINE)


# ══════════════════════════════════════════════════════════════════════════
# Result + error types
# ══════════════════════════════════════════════════════════════════════════

class LLMJsonError(Exception):
    """Raised when the LLM never produced parseable JSON.

    Carries enough context for ops debugging (`raw`, `attempts`) and for the
    router layer to show a friendly user message based on `reason`.

    Reasons you'll see in practice
    ──────────────────────────────
    • 'empty'                — model returned an empty string (often a safety
                               filter blanking the response, or a token-cap
                               timeout — Gemini's `response.text` is None).
    • 'parse_error: ...'     — model returned something, but it didn't parse
                               as JSON even after fence stripping.
    • 'wrong_type: ...'      — JSON parsed but isn't the shape we wanted
                               (e.g. dict when we asked for a list).
    • 'call_error: ...'      — network/quota/timeout from the provider.
    """

    def __init__(self, reason: str, raw: str, attempts: int, detail: str = ""):
        self.reason   = reason
        self.raw      = raw
        self.attempts = attempts
        self.detail   = detail
        super().__init__(f"{reason} after {attempts} attempt(s): {detail}".strip())


@dataclass
class _Outcome:
    """Internal per-attempt result; not exported."""
    data:   Any | None
    reason: str | None
    raw:    str


# ══════════════════════════════════════════════════════════════════════════
# Parsing
# ══════════════════════════════════════════════════════════════════════════

def _extract_json_payload(raw: str) -> str:
    """Strip whitespace, prose preambles, and markdown fences.

    Order of operations:
      1. If a ```json … ``` (or ``` … ```) fenced block is present anywhere,
         extract its inner content. This is the most precise signal a model
         can give us, so it wins.
      2. Otherwise, find the first { or [ and discard anything before it
         (typical "Here's the JSON:" preambles).
      3. As a last resort, return the trimmed raw.
    """
    if not raw:
        return ""
    fence_match = _FENCE_PATTERN.search(raw)
    if fence_match:
        return fence_match.group(1).strip()
    cleaned = raw.strip()
    for i, ch in enumerate(cleaned):
        if ch in "{[":
            return cleaned[i:]
    return cleaned


def safe_json_parse(raw: str) -> tuple[Any | None, str | None]:
    """Strip + parse. Returns `(data, error_reason)`.

    `error_reason` is None on success. On failure, it's one of:
      • 'empty'             — input was empty / whitespace-only
      • 'empty_after_strip' — fences/prose stripping left nothing behind
      • 'parse_error: ...'  — JSONDecodeError from the stdlib
    """
    if not raw or not raw.strip():
        return None, "empty"
    payload = _extract_json_payload(raw)
    if not payload:
        return None, "empty_after_strip"
    try:
        return json.loads(payload), None
    except json.JSONDecodeError as exc:
        return None, f"parse_error: {exc.msg} at line {exc.lineno} col {exc.colno}"


# ══════════════════════════════════════════════════════════════════════════
# Retry loop
# ══════════════════════════════════════════════════════════════════════════

_RETRY_REMINDER = (
    "\n\n--- IMPORTANT ---\n"
    "Your previous response could not be parsed as JSON. Reply with "
    "VALID JSON ONLY — no markdown fences, no commentary, no leading or "
    "trailing prose. The response must be parseable by json.loads on the "
    "first try."
)


def call_llm_for_json(
    llm_call:       Callable[[str], str],
    base_prompt:    str,
    *,
    max_attempts:   int = 3,
    expected_type:  Type | None = None,
    label:          str = "llm",
) -> Any:
    """Call an LLM expecting JSON; retry up to `max_attempts` times.

    Parameters
    ──────────
    llm_call      : a function taking a prompt string and returning the
                    raw model output. Should NOT itself swallow exceptions
                    into a fake "everything is fine" string — let them
                    propagate; we'll catch and retry.
    base_prompt   : the user-side prompt. Retry attempts append a stricter
                    "JSON only, no markdown" reminder.
    max_attempts  : default 3. First attempt uses base_prompt verbatim;
                    attempts 2..N append the reminder.
    expected_type : optional `list` or `dict`. If set, parsed output that
                    isn't this type counts as a failed attempt.
    label         : appears in log lines so we can grep specific callers.

    Raises
    ──────
    LLMJsonError when no attempt produces valid JSON.
    """
    last_raw    = ""
    last_reason = "no_attempts"

    for attempt in range(1, max_attempts + 1):
        prompt = base_prompt if attempt == 1 else (base_prompt + _RETRY_REMINDER)

        try:
            raw = llm_call(prompt) or ""
        except Exception as exc:  # pragma: no cover — provider failure modes vary
            log.warning(
                "[llm_json:%s] call exception attempt %d/%d: %s",
                label, attempt, max_attempts, exc,
            )
            last_reason = f"call_error: {exc}"
            continue

        last_raw = raw
        data, err = safe_json_parse(raw)

        if data is None:
            log.warning(
                "[llm_json:%s] parse failed attempt %d/%d: reason=%s, raw_first_200=%r",
                label, attempt, max_attempts, err, raw[:200],
            )
            last_reason = err or "parse_error"
            continue

        if expected_type is not None and not isinstance(data, expected_type):
            log.warning(
                "[llm_json:%s] wrong type attempt %d/%d: expected %s, got %s",
                label, attempt, max_attempts,
                expected_type.__name__, type(data).__name__,
            )
            last_reason = f"wrong_type: expected {expected_type.__name__}"
            continue

        return data

    raise LLMJsonError(
        reason=last_reason,
        raw=last_raw,
        attempts=max_attempts,
        detail=last_reason,
    )


# ══════════════════════════════════════════════════════════════════════════
# User-facing message mapping
# ══════════════════════════════════════════════════════════════════════════

def user_message_for(error: LLMJsonError) -> str:
    """Translate the technical failure reason into something the UI can show.

    Routers use this to populate the `detail` field of their HTTP exception
    so users see "the AI didn't return any text — try again" instead of
    "Question extraction returned unparseable JSON: Expecting value...".
    """
    reason = error.reason or ""
    if reason.startswith("empty") or "empty" in reason:
        return (
            "The AI didn't return any text for this document — this can happen "
            "when a content filter blanks the response or the file is too dense. "
            "Try uploading again. If it keeps failing, fill the details manually."
        )
    if reason.startswith("parse_error"):
        return (
            "The AI returned malformed text we couldn't parse. Please try again — "
            "if it persists, the document may need OCR or manual entry."
        )
    if reason.startswith("wrong_type"):
        return (
            "The AI returned data in an unexpected shape. Please try again."
        )
    if reason.startswith("call_error"):
        return (
            "We couldn't reach the AI service. Please try again in a moment."
        )
    return "We had trouble reading this document. Please try again or fill the details manually."
