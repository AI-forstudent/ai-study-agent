"""
app/services/markdown_to_pdf.py
───────────────────────────────
F-036 — render a markdown string (the AI-generated unified summary) into
a PDF. The PDF is stored as a UserDocument so the lecture viewer can open
it in the existing MainWorkspace identically to any other library PDF.

Pipeline
────────
  markdown text
     │  python-markdown (CommonMark + a couple of extensions)
     ▼
  HTML fragment
     │  wrapped in an RTL-aware <html> shell with print CSS
     ▼
  weasyprint
     ▼
  PDF bytes

LaTeX math
──────────
This first cut renders math as raw `$x$` text (the markdown library doesn't
touch dollar-delimited content). Full math typesetting needs KaTeX HTML
which weasyprint can paint, or a JS-rendered pipeline. Deferred — the
user signed off on "PDF for now; LaTeX export later".

RTL / Hebrew
────────────
Output is intended to be Hebrew. The HTML root carries `dir="rtl"` and
`lang="he"`; the body font stack starts with Noto Sans Hebrew (installed
via the Dockerfile) and falls back to DejaVu Sans / Liberation Sans.
"""

from __future__ import annotations

import logging
from html import escape
from typing import Optional

import markdown as md_lib

log = logging.getLogger(__name__)

# Markdown extensions: 'fenced_code' for ``` blocks, 'tables' for GFM
# tables, 'sane_lists' so single-blank lines don't accidentally end a list,
# and 'attr_list' so the model's occasional `{#anchor}` doesn't render as
# literal text. Math (`$...$`) intentionally passes through untouched.
_MD_EXTENSIONS = ["fenced_code", "tables", "sane_lists", "attr_list", "toc"]

_HTML_SHELL = """<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  @page {{
    size: A4;
    margin: 24mm 22mm 24mm 22mm;
    @top-center {{
      content: "{title}";
      font-family: "Noto Sans Hebrew", "DejaVu Sans", "Liberation Sans", sans-serif;
      font-size: 9pt;
      color: #6b7280;
    }}
    @bottom-right {{
      content: counter(page) " / " counter(pages);
      font-family: "Noto Sans Hebrew", "DejaVu Sans", "Liberation Sans", sans-serif;
      font-size: 9pt;
      color: #9ca3af;
    }}
  }}
  html {{ font-size: 11pt; }}
  body {{
    font-family: "Noto Sans Hebrew", "DejaVu Sans", "Liberation Sans", sans-serif;
    line-height: 1.55;
    color: #111827;
  }}
  h1 {{ font-size: 22pt; margin: 0 0 8mm; color: #111827; }}
  h2 {{ font-size: 16pt; margin: 6mm 0 3mm; padding-bottom: 1mm; border-bottom: 1px solid #e5e7eb; }}
  h3 {{ font-size: 13pt; margin: 5mm 0 2mm; color: #1f2937; }}
  h4 {{ font-size: 11pt; margin: 4mm 0 2mm; color: #374151; }}
  p  {{ margin: 0 0 3mm; }}
  ul, ol {{ margin: 0 0 3mm; padding-inline-start: 6mm; }}
  li {{ margin: 0.5mm 0; }}
  blockquote {{
    margin: 3mm 0; padding: 2mm 3mm;
    border-inline-start: 3px solid #c7d2fe;
    background: #eef2ff;
    color: #1e1b4b;
  }}
  code {{
    background: #f3f4f6; padding: 0.5mm 1mm; border-radius: 0.5mm;
    font-family: "DejaVu Sans Mono", monospace;
    font-size: 10pt;
  }}
  pre {{
    background: #f9fafb; padding: 3mm; border-radius: 1mm;
    overflow-x: auto;
    font-family: "DejaVu Sans Mono", monospace;
    font-size: 10pt;
    direction: ltr;
  }}
  pre code {{ background: transparent; padding: 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 3mm 0; }}
  th, td {{ border: 1px solid #d1d5db; padding: 1.5mm 2mm; text-align: start; }}
  th {{ background: #f3f4f6; font-weight: 600; }}
  hr {{ border: none; border-top: 1px solid #e5e7eb; margin: 5mm 0; }}
  /* Header strip with title + course title */
  .doc-header {{
    margin-bottom: 6mm;
    padding-bottom: 3mm;
    border-bottom: 2px solid #4f46e5;
  }}
  .doc-header .course {{
    font-size: 10pt;
    color: #4f46e5;
    margin-bottom: 1mm;
  }}
  .doc-header .title {{
    font-size: 20pt;
    font-weight: 600;
    color: #111827;
  }}
</style>
</head>
<body>
{header}
{body}
</body>
</html>
"""


def render_unified_summary_pdf(
    markdown_text: str,
    *,
    lecture_title: str,
    course_title:  Optional[str] = None,
) -> bytes:
    """Render `markdown_text` to a PDF and return the bytes.

    `lecture_title` is used as the page header and the document <title>.
    `course_title` is rendered above the lecture title in the header strip.
    """
    md = md_lib.Markdown(extensions=_MD_EXTENSIONS, output_format="html5")
    body_html = md.convert(markdown_text or "")

    header_html = (
        '<div class="doc-header">'
        f'<div class="course">{escape(course_title)}</div>' if course_title else '<div class="doc-header">'
    )
    if not course_title:
        # We already started the wrapper without the course line; finish it.
        header_html = '<div class="doc-header">'
    else:
        header_html = f'<div class="doc-header"><div class="course">{escape(course_title)}</div>'
    header_html += f'<div class="title">{escape(lecture_title)}</div></div>'

    full_html = _HTML_SHELL.format(
        title=escape(lecture_title or "Lecture summary"),
        header=header_html,
        body=body_html,
    )

    # Import inside the function so a missing system library only fails
    # the actual generation call, not the module import on app startup.
    from weasyprint import HTML

    pdf_bytes = HTML(string=full_html).write_pdf()
    if pdf_bytes is None:
        raise RuntimeError("weasyprint returned no bytes")
    return pdf_bytes
