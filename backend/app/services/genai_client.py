"""
app/services/genai_client.py
────────────────────────────
Lazy singleton for the Google GenAI client (google-genai SDK).

One Client instance is created per process and reused across all requests.
The initialisation is deferred until the first call so a missing API key
fails at request time (with a clear error) rather than crashing the whole
server on startup.

Usage:
    from app.services.genai_client import get_client
    client = get_client()
    response = client.models.generate_content(model="...", contents=[...])
"""

from __future__ import annotations

from google import genai

from app.core.config import GOOGLE_API_KEY

_client: genai.Client | None = None


def get_client() -> genai.Client:
    """Return (or lazily create) the module-level GenAI client."""
    global _client
    if _client is None:
        if not GOOGLE_API_KEY:
            raise RuntimeError(
                "[genai_client] GOOGLE_API_KEY is not set. "
                "Add it to backend/.env before starting the server."
            )
        _client = genai.Client(api_key=GOOGLE_API_KEY)
    return _client
