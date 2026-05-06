"""
app/services/llm_providers.py
──────────────────────────────
Multi-provider LLM routing layer.

Supports: Gemini (Google), OpenAI (ChatGPT), Anthropic (Claude).
Falls back to Gemini if a provider's API key is missing.

Usage:
    from app.services.llm_providers import call_llm

    reply = call_llm(
        provider="openai",          # "gemini" | "openai" | "anthropic"
        model_tier="flash",         # "flash-lite" | "flash" | "pro"
        system_prompt="You are...",
        history=[{"role": "user", "content": "Hello"}],
    )
"""

from __future__ import annotations

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


# ── Provider implementations ───────────────────────────────────────────────

def _call_gemini(model: str, system_prompt: str, history: list[dict]) -> str:
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
    return response.text


def _call_openai(model: str, system_prompt: str, history: list[dict]) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY)
    messages = [{"role": "system", "content": system_prompt}] + [
        {"role": msg["role"], "content": msg["content"]} for msg in history
    ]
    response = client.chat.completions.create(model=model, messages=messages)
    return response.choices[0].message.content or ""


def _call_anthropic(model: str, system_prompt: str, history: list[dict]) -> str:
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
    return response.content[0].text


# ── Public entry point ─────────────────────────────────────────────────────

def call_llm(
    provider: str | None,
    model_tier: str | None,
    system_prompt: str,
    history: list[dict],
) -> str:
    """Route to the correct provider and return the assistant reply text.

    Falls back to Gemini if the requested provider's key is not configured.
    """
    p = (provider or "gemini").lower()

    if p == "openai" and OPENAI_API_KEY:
        model = _resolve_model("openai", model_tier)
        return _call_openai(model, system_prompt, history)

    if p == "anthropic" and ANTHROPIC_API_KEY:
        model = _resolve_model("anthropic", model_tier)
        return _call_anthropic(model, system_prompt, history)

    # Default / fallback: Gemini
    model = _resolve_model("gemini", model_tier)
    return _call_gemini(model, system_prompt, history)
