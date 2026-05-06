"""
app/services/syllabus_extractor.py
───────────────────────────────────
Single-pass Gemini extraction of structured syllabus data.

Run once when a syllabus document is attached to a Course; the result is
cached on Course.syllabus_extracted (JSONB) and re-used by every subsequent
course-scoped chat. No re-extraction unless the syllabus document changes.

Token budget
────────────
~3-8k tokens per syllabus depending on length. The extracted JSON is small
(typically <2 kB) so storing it costs nothing. Reading the extraction back
during chat is free (no LLM involved).

Output shape
────────────
{
  "topics":          ["Limits", "Continuity", "Differentiation", ...],
  "books":           ["Stewart - Calculus 8th ed.", ...],
  "lecturers":       [{"name": "Dr. Cohen", "email": null, "role": "lecturer"}],
  "grading_policy":  "Final 70%, midterm 20%, HW 10%",
  "prerequisites":   ["Calculus 1", "Linear Algebra 1"],
  "weekly_breakdown":[{"week": 1, "topic": "Sequences"}, ...],
  "course_code":     "104031",
  "institution":     "Ben-Gurion University",
  "semester":        "Fall 2026",
  "language":        "Hebrew"
}

Every field is best-effort; the extractor returns null/empty when the
syllabus doesn't contain that information rather than guessing.
"""

from __future__ import annotations

from typing import Any

from app.services.llm_json import call_llm_for_json

# NOTE: `ask_gemini_json` is imported lazily inside `extract_syllabus` to break
# a circular import. document_service imports prompt_builder, which now imports
# this module — a top-level `from app.services.document_service import ...`
# would close the cycle. Lazy import keeps each module's top-level imports
# acyclic.


_EXTRACTION_PROMPT = """\
You are a syllabus parser. Extract structured information from the following
course syllabus. Return ONLY a valid JSON object matching this exact schema —
no prose, no markdown fences:

{{
  "topics":           array of short topic name strings,
  "books":            array of "Author - Title (edition)" strings,
  "lecturers":        array of {{"name": str, "email": str|null, "role": "lecturer"|"ta"|"guest"}},
  "grading_policy":   string|null,
  "prerequisites":    array of course-name strings,
  "weekly_breakdown": array of {{"week": int, "topic": str}},
  "course_code":      string|null,
  "institution":      string|null,
  "semester":         string|null,
  "language":         "Hebrew"|"English"|"Other"
}}

Rules
─────
• Topic names should be concise (1-4 words) and ready to use as tags.
• If a field is not present in the syllabus, return null (or empty array).
• Do NOT invent information; do NOT translate proper nouns.
• Hebrew text is supported. Return values in the syllabus's original language.
• Course names in `prerequisites` should be human-readable, not just codes.

Syllabus text
─────────────
{text}
"""


def extract_syllabus(text: str) -> dict[str, Any]:
    """Run a single Gemini call and return the parsed structured dict.

    Routes through `services.llm_json.call_llm_for_json` which:
      • Forces native JSON mode at the API level (`ask_gemini_json`).
      • Strips fences / prose preambles defensively.
      • Retries up to 3 times with a stricter "JSON only" reminder.
      • Raises `LLMJsonError` (caught and translated to user-friendly
        404/502 by the courses router) if every attempt fails.
    """
    if not text or not text.strip():
        return _empty_extraction()

    # Lazy import — see top-of-file note about the document_service cycle.
    from app.services.document_service import ask_gemini_json

    # Cap the syllabus body at a generous-but-bounded token budget. Most
    # syllabi are 3-10 pages; 12k characters comfortably covers that without
    # blowing past the model's context window or our cost expectations.
    capped = text[:12_000]
    base_prompt = _EXTRACTION_PROMPT.format(text=capped)

    parsed = call_llm_for_json(
        llm_call=lambda p: ask_gemini_json(p, use_smart_model=True),
        base_prompt=base_prompt,
        max_attempts=3,
        expected_type=dict,
        label="syllabus_extractor",
    )

    return _normalize_extraction(parsed)


def _empty_extraction() -> dict[str, Any]:
    return {
        "topics":           [],
        "books":            [],
        "lecturers":        [],
        "grading_policy":   None,
        "prerequisites":    [],
        "weekly_breakdown": [],
        "course_code":      None,
        "institution":      None,
        "semester":         None,
        "language":         None,
    }


def _normalize_extraction(parsed: Any) -> dict[str, Any]:
    """Coerce the LLM output into the strict schema, filling missing keys.

    The extractor returns whatever Gemini produced — model drift can introduce
    unexpected types or missing keys. This function defends downstream code
    (which assumes the schema) by patching defaults.
    """
    if not isinstance(parsed, dict):
        return _empty_extraction()

    out = _empty_extraction()
    out["topics"]           = _as_str_list(parsed.get("topics"))
    out["books"]            = _as_str_list(parsed.get("books"))
    out["prerequisites"]    = _as_str_list(parsed.get("prerequisites"))
    out["grading_policy"]   = parsed.get("grading_policy") or None
    out["course_code"]      = parsed.get("course_code") or None
    out["institution"]      = parsed.get("institution") or None
    out["semester"]         = parsed.get("semester") or None
    out["language"]         = parsed.get("language") or None

    lecturers = parsed.get("lecturers") or []
    if isinstance(lecturers, list):
        out["lecturers"] = [
            {
                "name":  str(lec.get("name", "")).strip(),
                "email": (lec.get("email") or None),
                "role":  (lec.get("role") or "lecturer"),
            }
            for lec in lecturers
            if isinstance(lec, dict) and lec.get("name")
        ]

    weekly = parsed.get("weekly_breakdown") or []
    if isinstance(weekly, list):
        out["weekly_breakdown"] = [
            {"week": int(w.get("week", 0)), "topic": str(w.get("topic", "")).strip()}
            for w in weekly
            if isinstance(w, dict) and w.get("topic")
        ]

    return out


def _as_str_list(val: Any) -> list[str]:
    if not isinstance(val, list):
        return []
    return [str(item).strip() for item in val if item and str(item).strip()]


# ── Prompt-side summary used by chat (Q3=c — Anthropic cache_control) ──────

def build_syllabus_system_block(extracted: dict[str, Any] | None, course_title: str) -> str:
    """Compose the system-prompt block injected into course-scoped chats.

    Kept compact (typically 300-800 tokens) so it's cheap on every turn for
    OpenAI/Gemini, and Anthropic-friendly for prompt caching with cache_control.
    Returns an empty string when there is no extraction yet.
    """
    if not extracted:
        return ""

    lines: list[str] = []
    lines.append(f"## COURSE CONTEXT — {course_title}")

    if extracted.get("course_code") or extracted.get("institution"):
        meta_bits = []
        if extracted.get("course_code"):
            meta_bits.append(f"Code: {extracted['course_code']}")
        if extracted.get("institution"):
            meta_bits.append(extracted["institution"])
        if extracted.get("semester"):
            meta_bits.append(extracted["semester"])
        lines.append(" · ".join(meta_bits))

    if extracted.get("topics"):
        lines.append("\n### Topics covered")
        lines.append(", ".join(extracted["topics"][:40]))

    if extracted.get("books"):
        lines.append("\n### Reading list")
        for book in extracted["books"][:8]:
            lines.append(f"- {book}")

    lecturers = extracted.get("lecturers") or []
    if lecturers:
        lines.append("\n### Teaching staff")
        for lec in lecturers[:6]:
            role = lec.get("role", "lecturer")
            lines.append(f"- {lec['name']} ({role})")

    if extracted.get("prerequisites"):
        lines.append("\n### Prerequisites")
        lines.append(", ".join(extracted["prerequisites"][:10]))

    if extracted.get("grading_policy"):
        lines.append("\n### Grading")
        lines.append(extracted["grading_policy"])

    lines.append(
        "\nWhen helping the student, ground answers in this course's topics, "
        "match the textbook conventions, and respect the prerequisites — "
        "don't assume material from later courses unless the student asks."
    )

    return "\n".join(lines)
