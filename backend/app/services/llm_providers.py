"""
app/services/llm_providers.py
──────────────────────────────
Multi-provider LLM routing layer.

Supports: Gemini (Google), OpenAI (ChatGPT), Anthropic (Claude).
Falls back to Gemini if a provider's API key is missing.

Two entry points
────────────────
• `call_llm(...)` — backwards-compatible string return for existing callers.
• `call_llm_with_usage(...)` — returns a `LLMReply` dataclass with the reply
  text + token counts + cost. Use this from any new code path so the call
  can record a UsageEvent (F-005 Phase 2 / T-008).

Usage logging is intentionally NOT done inside this module — keeping it
provider-pure means tests don't need a DB session. The router is responsible
for calling `write_usage_event(db, user_id, endpoint, reply)` after a
successful call.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY


# ── Per-provider tier → model mapping ─────────────────────────────────────

_PROVIDER_TIER_MAP: dict[str, dict[str, str]] = {
    "gemini": {
        "flash-lite": "gemini-2.5-flash-lite",
        "flash":      "gemini-2.5-flash",
        "pro":        "gemini-2.5-pro",
    },
    "openai": {
        "flash-lite": "gpt-4o-mini",
        "flash":      "gpt-4o",
        "pro":        "gpt-4.1",
    },
    "anthropic": {
        "flash-lite": "claude-haiku-4-5-20251001",
        "flash":      "claude-sonnet-4-6",
        "pro":        "claude-opus-4-7",
    },
}

_DEFAULT_TIER = "flash"


def _resolve_model(provider: str, tier: str | None) -> str:
    tier_map = _PROVIDER_TIER_MAP.get(provider, _PROVIDER_TIER_MAP["gemini"])
    return tier_map.get(tier or _DEFAULT_TIER, tier_map[_DEFAULT_TIER])


# ── Reply container ───────────────────────────────────────────────────────

@dataclass
class LLMReply:
    """Provider-agnostic shape returned from `call_llm_with_usage`.

    Token counts are best-effort — providers occasionally omit usage fields
    on streaming/error paths; we default to 0 in that case so the row still
    inserts (the caller can decide whether 0-token rows are noise).
    """
    text:          str
    provider:      str        # 'gemini' | 'openai' | 'anthropic'
    model:         str        # raw provider model id
    input_tokens:  int = 0
    output_tokens: int = 0


# ── Provider implementations ───────────────────────────────────────────────

def _call_gemini(model: str, system_prompt: str, history: list[dict]) -> LLMReply:
    from google.genai import types as genai_types
    from app.services.genai_client import get_client

    contents = [
        genai_types.Content(
            role="user" if msg["role"] == "user" else "model",
            parts=[genai_types.Part.from_text(text=msg["content"])],
        )
        for msg in history
    ]
    client = get_client()
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=genai_types.GenerateContentConfig(system_instruction=system_prompt),
    )
    # Gemini's usage_metadata fields are camelCase-ish in the SDK Python
    # bindings. Use getattr defensively because SDK upgrades have shifted
    # field names in the past.
    um = getattr(response, "usage_metadata", None)
    return LLMReply(
        text=response.text or "",
        provider="gemini",
        model=model,
        input_tokens=getattr(um, "prompt_token_count", 0) or 0,
        output_tokens=getattr(um, "candidates_token_count", 0) or 0,
    )


def _call_openai(model: str, system_prompt: str, history: list[dict]) -> LLMReply:
    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY)
    messages = [{"role": "system", "content": system_prompt}] + [
        {"role": msg["role"], "content": msg["content"]} for msg in history
    ]
    response = client.chat.completions.create(model=model, messages=messages)
    usage = getattr(response, "usage", None)
    return LLMReply(
        text=response.choices[0].message.content or "",
        provider="openai",
        model=model,
        input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
        output_tokens=getattr(usage, "completion_tokens", 0) or 0,
    )


def _call_anthropic(model: str, system_prompt: str, history: list[dict]) -> LLMReply:
    from anthropic import Anthropic

    client = Anthropic(api_key=ANTHROPIC_API_KEY)
    messages = [
        {"role": msg["role"], "content": msg["content"]} for msg in history
    ]
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=system_prompt,
        messages=messages,
    )
    usage = getattr(response, "usage", None)
    return LLMReply(
        text=response.content[0].text,
        provider="anthropic",
        model=model,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
    )


# ── Public entry points ────────────────────────────────────────────────────

def call_llm_with_usage(
    provider: str | None,
    model_tier: str | None,
    system_prompt: str,
    history: list[dict],
) -> LLMReply:
    """Like `call_llm` but returns a `LLMReply` carrying token usage. Falls
    back to Gemini if the requested provider's key is missing — the
    `provider` field of the reply reflects what actually ran, not what was
    requested, so usage logs aren't misleading."""
    p = (provider or "gemini").lower()

    if p == "openai" and OPENAI_API_KEY:
        return _call_openai(_resolve_model("openai", model_tier), system_prompt, history)

    if p == "anthropic" and ANTHROPIC_API_KEY:
        return _call_anthropic(_resolve_model("anthropic", model_tier), system_prompt, history)

    return _call_gemini(_resolve_model("gemini", model_tier), system_prompt, history)


def call_llm(
    provider: str | None,
    model_tier: str | None,
    system_prompt: str,
    history: list[dict],
) -> str:
    """Backwards-compatible string return. Existing callers (chat router,
    document service, etc.) keep working unchanged. New code should prefer
    `call_llm_with_usage` so it can record a UsageEvent."""
    return call_llm_with_usage(provider, model_tier, system_prompt, history).text
