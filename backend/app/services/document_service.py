"""
app/services/document_service.py
──────────────────────────────────
AI and PDF logic migrated from the legacy backend/services.py.

Key changes vs. legacy:
  - All model imports use app.models.domain (not the flat models.py).
  - GOOGLE_API_KEY is read from app.core.config.
  - get_chat_response_for_thread uses resolve_system_prompt (prompt_builder)
    which handles system_prompt → manual_prompt_override → default priority
    and also appends persisted SessionMemory entries.
  - compose_system_prompt (trait-based builder) is kept for backward
    compatibility with legacy personas that only have traits, not system_prompt.
"""

from __future__ import annotations

import json
import os
import subprocess
from typing import List, Optional

import pdfplumber
from docx import Document as DocxDocument
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import Integer, cast, null, or_, select
from sqlalchemy.orm import Session, aliased

from app.core.config import GOOGLE_API_KEY
from app.models.domain import Chunk, Message, Persona, Thread
from app.services.prompt_builder import resolve_system_prompt


# ── Defaults & trait library ───────────────────────────────────────────────

_DEFAULT_SYSTEM_PROMPT = "You are a helpful and precise private tutor."

TRAIT_LIBRARY: dict[str, dict[str, str]] = {
    "pedagogy": {
        "socratic":       "Guide the student toward the answer using targeted questions. Never state the answer directly — ask instead.",
        "direct":         "Provide clear, direct explanations. State the answer first, then justify it.",
        "constructivist": "Connect new concepts to what the student already knows. Build understanding incrementally.",
    },
    "style": {
        "concise":  "Keep every response under 5 lines. Prioritize the single most important insight.",
        "detailed": "Provide thorough, well-structured explanations. Use examples and analogies freely.",
        "visual":   "Prefer bullet points, numbered steps, and tables over prose paragraphs.",
    },
    "tone": {
        "encouraging": "Be warm and supportive. Acknowledge effort explicitly before correcting mistakes.",
        "neutral":     "Maintain a professional, objective tone throughout.",
        "challenging": "Push the student to think harder. End responses with a follow-up question that deepens understanding.",
    },
    "language": {
        "hebrew":    "Always respond in Hebrew, regardless of the question's language.",
        "english":   "Always respond in English.",
        "bilingual": "Use Hebrew for explanations; use English for technical terms and code.",
    },
}

_TRAIT_SECTION_LABELS: dict[str, str] = {
    "pedagogy": "## TEACHING METHOD",
    "style":    "## RESPONSE STYLE",
    "tone":     "## TONE",
    "language": "## LANGUAGE",
}


def compose_system_prompt(persona_id: str, db: Session) -> str:
    """Backward-compatible trait-based prompt builder for legacy personas.

    Priority: manual_prompt_override → traits → default.
    Use resolve_system_prompt (prompt_builder) for new personas — it also
    appends SessionMemory and prefers the richer system_prompt field.
    """
    persona = db.query(Persona).filter(Persona.id == persona_id).first()
    if not persona:
        return _DEFAULT_SYSTEM_PROMPT

    if persona.manual_prompt_override:
        return persona.manual_prompt_override

    traits: dict = persona.traits or {}
    if not traits:
        return _DEFAULT_SYSTEM_PROMPT

    fragments = [f"## ROLE\nYou are {persona.display_name}, a specialized AI study assistant.\n"]
    for trait_key, section_header in _TRAIT_SECTION_LABELS.items():
        value = traits.get(trait_key)
        if not value:
            continue
        fragment = TRAIT_LIBRARY.get(trait_key, {}).get(value)
        fragments.append(f"{section_header}\n{fragment if fragment else value}")

    return "\n\n".join(fragments)


# ── LLM factory ────────────────────────────────────────────────────────────

def get_smart_model() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash-lite",
        temperature=0.3,
        google_api_key=GOOGLE_API_KEY,
        timeout=15,
        max_retries=1,
    )


def get_fast_model() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash-lite",
        temperature=0.5,
        google_api_key=GOOGLE_API_KEY,
        timeout=15,
        max_retries=1,
    )


def ask_gemini(prompt: str, use_smart_model: bool = False) -> str:
    try:
        llm = get_smart_model() if use_smart_model else get_fast_model()
        response = llm.invoke(prompt)
        content = response.content
        if isinstance(content, list):
            return "\n\n".join(
                item["text"] for item in content
                if isinstance(item, dict) and "text" in item
            )
        return content if isinstance(content, str) else str(content)
    except Exception as e:
        print(f"[ERROR] Gemini API error: {e}")
        return "מצטער, שירות הענן (Gemini) עמוס או לא זמין כרגע. אנא נסה שוב בעוד מספר רגעים. 🔄"


def get_embedding_model() -> GoogleGenerativeAIEmbeddings:
    return GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-001",
        google_api_key=GOOGLE_API_KEY,
        task_type="retrieval_document",
        output_dimensionality=768,
    )


def check_llm_connection() -> tuple[bool, str]:
    try:
        get_embedding_model().embed_query("test")
        return True, "Connected to the model"
    except Exception as e:
        return False, f"Connection Failed: {str(e)}"


# ── Code file support ─────────────────────────────────────────────────────

CODE_EXTENSIONS: frozenset[str] = frozenset({
    ".py", ".js", ".ts", ".tsx", ".jsx",
    ".html", ".css", ".scss",
    ".json", ".yaml", ".yml", ".toml",
    ".cpp", ".c", ".h", ".hpp",
    ".java", ".kt", ".go", ".rs",
    ".sh", ".sql",
})


def is_code_file(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in CODE_EXTENSIONS


# ── PDF extraction & chunking ──────────────────────────────────────────────

def extract_text_from_pdf(file_path: str) -> list[dict]:
    pages_content = []
    try:
        with pdfplumber.open(file_path) as pdf:
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                if text:
                    pages_content.append({"page_number": i + 1, "text": text})
    except Exception as e:
        print(f"[ERROR] Error reading PDF: {e}")
    return pages_content


def extract_text_from_word(file_path: str) -> list[dict]:
    """Read a Word (.docx) file and split into virtual pages of 25 paragraphs each."""
    PARAS_PER_PAGE = 25
    try:
        doc = DocxDocument(file_path)
        paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
        if not paragraphs:
            return []
        pages = []
        for i in range(0, len(paragraphs), PARAS_PER_PAGE):
            chunk = paragraphs[i:i + PARAS_PER_PAGE]
            pages.append({"page_number": len(pages) + 1, "text": "\n".join(chunk)})
        return pages
    except Exception as e:
        print(f"[ERROR] Failed to read Word file {file_path}: {e}")
        return []


def extract_text_from_code(file_path: str) -> list[dict]:
    """Read a source-code file as plain UTF-8 text.

    Returns a single-element list so it is drop-in compatible with
    extract_text_from_pdf's list[dict] contract. The entire file is
    treated as page 1; a header line gives the AI filename context.
    """
    filename = os.path.basename(file_path)
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        text = f"=== File: {filename} ===\n\n{content}"
        return [{"page_number": 1, "text": text}]
    except Exception as e:
        print(f"[ERROR] Failed to read code file {file_path}: {e}")
        return []


def convert_to_pdf(input_path: str, output_dir: str) -> str:
    """Convert an Office document to PDF using LibreOffice headless.

    Returns the path of the generated PDF file.
    Raises RuntimeError if LibreOffice returns a non-zero exit code or the
    expected output file is not found.
    """
    result = subprocess.run(
        ["libreoffice", "--headless", "--convert-to", "pdf", input_path, "--outdir", output_dir],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"LibreOffice conversion failed: {result.stderr.strip()}")
    basename = os.path.splitext(os.path.basename(input_path))[0]
    pdf_path = os.path.join(output_dir, f"{basename}.pdf")
    if not os.path.exists(pdf_path):
        raise RuntimeError(
            f"Expected PDF not found at {pdf_path}. LibreOffice output: {result.stdout.strip()}"
        )
    return pdf_path


def extract_text(file_path: str) -> list[dict]:
    """Unified dispatcher: routes to the correct extractor based on extension."""
    basename = os.path.basename(file_path).lower()
    if basename.endswith('.docx'):
        return extract_text_from_word(file_path)
    if is_code_file(basename):
        return extract_text_from_code(file_path)
    return extract_text_from_pdf(file_path)


def split_text_into_chunks(text: str, chunk_size: int = 1000, chunk_overlap: int = 200) -> list[str]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=["\n\n", "\n", " ", ""],
    )
    return splitter.split_text(text)


# ── Summaries ──────────────────────────────────────────────────────────────

def generate_document_summary(text: str) -> str:
    safe_text = text[:40000]
    prompt = (
        "You are an expert study assistant. "
        "Generate a comprehensive summary of the following document text.\n"
        f"Document Text:\n{safe_text}\nSummary:"
    )
    return ask_gemini(prompt, use_smart_model=True)


def generate_code_summary(text: str) -> str:
    """Software-architect-style summary for SOURCE_CODE documents."""
    safe_text = text[:40000]
    prompt = (
        "You are an expert Software Architect. "
        "Provide a high-level summary of this source code. "
        "Explain its primary purpose, main classes/functions, and key dependencies. "
        "Keep it concise.\n\n"
        f"Source Code:\n{safe_text}\n\nSummary:"
    )
    return ask_gemini(prompt, use_smart_model=True)


def generate_specific_page_summary(page_text: str) -> str:
    prompt = (
        "You are an expert study assistant. "
        "Generate a concise, well-structured, and highly informative summary of the following document page. "
        "Highlight key concepts, main arguments, and important terms.\n"
        "CRITICAL: Your response MUST be in HEBREW.\n"
        f"Page Text:\n{page_text}\nSummary:"
    )
    return ask_gemini(prompt, use_smart_model=True)


# ── Background task: thread metadata ──────────────────────────────────────

def generate_thread_metadata_background(
    thread_id: int,
    prompt_text: str,
    selected_text: str,
    db: Session,
) -> None:
    """Background task: generate title + emoji for a new thread via Gemini JSON mode."""
    cloud_prompt = (
        f'Analyze the following text from a document and the user\'s question about it.\n'
        f'Selected Text: "{selected_text}"\n'
        f'User Question: "{prompt_text}"\n\n'
        "Task:\n"
        "1. Create a short title in HEBREW (2-5 words) summarizing the conversation.\n"
        "2. Choose ONE relevant emoji that represents the topic.\n\n"
        'Respond ONLY with a valid JSON in this exact format, no markdown, no other text:\n'
        '{"title": "your hebrew title", "emoji": "your emoji"}'
    )

    new_title = new_emoji = None
    try:
        response_text = ask_gemini(cloud_prompt, use_smart_model=False)
        clean = response_text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(clean)
        new_title = parsed.get("title")
        new_emoji = parsed.get("emoji")
    except Exception as e:
        print(f"[ERROR] Metadata JSON parsing failed: {e}")

    if new_title or new_emoji:
        thread = db.query(Thread).filter(Thread.id == thread_id).first()
        if thread:
            if new_title and new_title != "שיחה חדשה":
                thread.title = new_title
            if new_emoji:
                thread.emoji = new_emoji
            db.commit()


# ── RAG: vector search ─────────────────────────────────────────────────────

def find_relevant_chunks(query: str, base_hash: str, db: Session, top_k: int = 3) -> list[str]:
    try:
        query_vector = get_embedding_model().embed_query(query)
        results = (
            db.query(Chunk)
            .filter(Chunk.base_hash == base_hash)
            .order_by(Chunk.embedding.cosine_distance(query_vector))
            .limit(top_k)
            .all()
        )
        return [f"[From Page {c.page_number}]: {c.text}" for c in results]
    except Exception as e:
        print(f"[WARNING] Vector search warning: {e}")
        return []


# ── Thread history traversal ───────────────────────────────────────────────

def get_thread_history_python(
    thread_id: int,
    db: Session,
    max_depth: int,
) -> Optional[List[Message]]:
    """Walk the thread tree in Python. Returns None if depth exceeds max_depth
    so the caller can fall back to the SQL CTE version."""
    history: list[Message] = []
    current_thread_id = thread_id
    limit_message_id = None
    depth = 0

    while current_thread_id:
        if depth > max_depth:
            return None  # signal to caller: switch to SQL CTE

        current_thread = db.query(Thread).filter(Thread.id == current_thread_id).first()
        if not current_thread:
            break

        query = db.query(Message).filter(Message.thread_id == current_thread_id)
        if limit_message_id is not None:
            query = query.filter(Message.id <= limit_message_id)

        messages = query.order_by(Message.id.asc()).all()
        history = messages + history  # prepend ancestor messages

        limit_message_id = current_thread.forked_from_message_id
        current_thread_id = current_thread.parent_thread_id
        depth += 1

    return history


def get_thread_history_sql(thread_id: int, db: Session) -> List[Message]:
    """Recursive CTE for arbitrarily deep thread trees (SQLAlchemy 2.0 style)."""
    base_query = (
        select(
            Thread.id.label("current_thread_id"),
            Thread.parent_thread_id,
            Thread.forked_from_message_id,
            cast(null(), Integer).label("limit_msg_id"),
        )
        .where(Thread.id == thread_id)
        .cte(name="thread_path", recursive=True)
    )

    t_alias = aliased(Thread)
    recursive_query = (
        select(
            t_alias.id,
            t_alias.parent_thread_id,
            t_alias.forked_from_message_id,
            base_query.c.forked_from_message_id,
        )
        .join(base_query, t_alias.id == base_query.c.parent_thread_id)
    )

    recursive_cte = base_query.union_all(recursive_query)

    stmt = (
        select(Message)
        .join(recursive_cte, Message.thread_id == recursive_cte.c.current_thread_id)
        .where(
            or_(
                recursive_cte.c.limit_msg_id.is_(None),
                Message.id <= recursive_cte.c.limit_msg_id,
            )
        )
        .order_by(Message.id.asc())
    )

    return list(db.execute(stmt).scalars().all())


def get_full_thread_history(thread_id: int, db: Session, max_depth: int = 3) -> List[Message]:
    """Hybrid router: Python walk for shallow trees, SQL CTE for deep ones."""
    history = get_thread_history_python(thread_id, db, max_depth)
    if history is None:
        history = get_thread_history_sql(thread_id, db)
    return history


# ── Core chat ──────────────────────────────────────────────────────────────

def get_chat_response_for_thread(
    history: list,
    selected_text: str,
    root_summary: str,
    base_hash: Optional[str],
    db: Session,
    current_page_text: str = "",
    thread_persona_id: Optional[str] = None,
) -> str:
    last_user_msg = history[-1].content if history else ""
    search_query = f"{selected_text} {last_user_msg}"
    relevant_context = find_relevant_chunks(search_query, base_hash, db) if base_hash else []
    relevant_context_str = "\n---\n".join(relevant_context)

    full_conversation = "".join(f"{msg.role}: {msg.content}\n" for msg in history)

    # Thread persona drives the prompt; resolve_system_prompt also appends
    # persisted SessionMemory so learning carries forward across sessions.
    active_persona_id = thread_persona_id
    system_prompt = (
        resolve_system_prompt(active_persona_id, db)
        if active_persona_id
        else _DEFAULT_SYSTEM_PROMPT
    )

    cloud_prompt = (
        f"{system_prompt}\n\n"
        "--- DATA SOURCE 1: IMMEDIATE CONTEXT (Full page) ---\n"
        f"{current_page_text}\n\n"
        "--- DATA SOURCE 2: RELEVANT KNOWLEDGE ---\n"
        f"{relevant_context_str}\n\n"
        "--- DATA SOURCE 3: GLOBAL SUMMARY ---\n"
        f"{root_summary}\n\n"
        "--- USER REQUEST ---\n"
        f'HIGHLIGHTED TEXT: "{selected_text}"\n'
        f"CHAT HISTORY:\n{full_conversation}\n\n"
        "INSTRUCTIONS: Answer in HEBREW. Use DATA SOURCE 1 for context. Keep answer SHORT (Max 7 lines).\n"
        "Your Answer:"
    )

    return ask_gemini(prompt=cloud_prompt, use_smart_model=False)
