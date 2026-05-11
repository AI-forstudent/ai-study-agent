"""
app/services/markdown_to_pdf.py
───────────────────────────────
F-036.4 — render the AI-generated unified-summary markdown into a PDF
using `pandoc` + `xelatex`.

Why the change from weasyprint
──────────────────────────────
weasyprint renders HTML, and HTML doesn't typeset LaTeX math by itself.
Since the skill instructs the AI to use `$x^2$` / `$$\nabla^2\phi$$`
for equations, the output contains raw LaTeX dollar markers everywhere;
weasyprint paints them as literal text. The result is unreadable for
physics content.

pandoc + xelatex does the right thing: markdown → LaTeX → typeset PDF
with proper math, RTL Hebrew (via polyglossia), automatic section
numbering, table of contents, etc.

Pipeline
────────
  AI markdown
     │  written to a temp .md file with a YAML front-matter header
     ▼
  pandoc --pdf-engine=xelatex --variable lang=he --variable dir=rtl ...
     ▼
  PDF bytes
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from typing import Optional

log = logging.getLogger(__name__)


# Pandoc invocation. The `-V` variables tune xelatex for Hebrew + math:
#  * mainfont — DejaVu Sans has Hebrew + Latin glyphs and ships with the
#               backend image (fonts-dejavu-core).
#  * lang/dir — drive polyglossia's RTL setup.
#  * geometry — sane margins for an A4 study document.
#  * --toc — pandoc auto-generates a table of contents from the ## headings
#            the AI produces, matching the reference example the user shared.
_PANDOC_BASE_ARGS = [
    "pandoc",
    "--from", "markdown+tex_math_dollars+tex_math_double_backslash+raw_tex",
    "--to",   "pdf",
    "--pdf-engine=xelatex",
    "--toc",
    "--standalone",
    "--variable", "mainfont=DejaVu Sans",
    "--variable", "lang=he",
    "--variable", "dir=rtl",
    "--variable", "geometry=margin=22mm",
    "--variable", "documentclass=article",
    "--variable", "papersize=a4",
    "--variable", "fontsize=11pt",
    "--variable", "linkcolor=blue",
    "--variable", "colorlinks=true",
]


def render_unified_summary_pdf(
    markdown_text: str,
    *,
    lecture_title: str,
    course_title:  Optional[str] = None,
) -> bytes:
    """Render `markdown_text` to a PDF and return the bytes.

    Writes the markdown to a temp file with a YAML front matter carrying
    the title/subtitle, invokes pandoc with the xelatex engine, and reads
    the resulting PDF back. Cleans up both temp files on the way out.

    Raises RuntimeError if pandoc fails — the caller's BG-task wrapper
    surfaces the error onto `Lecture.unified_summary_error` so the UI
    shows it.
    """
    if not markdown_text or not markdown_text.strip():
        raise ValueError("markdown_text is empty")

    # YAML front matter so pandoc renders the title page.
    title_yaml = lecture_title.replace('"', '\\"')
    subtitle_yaml = (course_title or "").replace('"', '\\"')
    front_matter = (
        "---\n"
        f'title: "{title_yaml}"\n'
        f'subtitle: "{subtitle_yaml}"\n'
        "---\n\n"
    )
    full_md = front_matter + markdown_text

    md_fd, md_path = tempfile.mkstemp(suffix=".md", text=False)
    pdf_path = md_path.replace(".md", ".pdf")
    try:
        with os.fdopen(md_fd, "wb") as fh:
            fh.write(full_md.encode("utf-8"))

        cmd = _PANDOC_BASE_ARGS + [md_path, "-o", pdf_path]
        try:
            subprocess.run(
                cmd,
                check=True,
                timeout=180,
                capture_output=True,
            )
        except subprocess.CalledProcessError as exc:
            # Surface stderr so the BG task's logging captures something
            # actionable. xelatex error messages live in stderr.
            stderr_text = (exc.stderr or b"").decode("utf-8", errors="replace")
            log.error("[markdown_to_pdf] pandoc failed: %s", stderr_text[:2000])
            raise RuntimeError(
                f"pandoc/xelatex failed: {stderr_text[:500]}"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("pandoc/xelatex timed out after 180s") from exc

        if not os.path.exists(pdf_path):
            raise RuntimeError("pandoc completed but produced no PDF")

        with open(pdf_path, "rb") as fh:
            return fh.read()
    finally:
        for p in (md_path, pdf_path):
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:                                  # pragma: no cover
                pass
