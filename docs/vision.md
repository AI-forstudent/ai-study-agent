# AI Study Partner — Product Vision & Long-Term Roadmap

> **Purpose:** Long-term *why* and *where-we're-going*. For *what-exists-today* see `SYSTEM_ARCHITECTURE.md`.
> **For the AI:** Use this file when a question requires understanding product intent (e.g. "should this feature be in the user's private namespace or in the shared commons?"). For implementation details, prefer `SYSTEM_ARCHITECTURE.md`.

---

## 1. Core Vision

This is not just a "Chat with PDF" tool. It is intended as the ultimate **Academic Operating System** — a hybrid ecosystem that blends powerful AI capabilities with a Notion/GitHub-inspired UI. The goal is a unified, highly personalized workspace where students manage their entire academic lifecycle: deep course-material analysis, community collaboration, and career prep.

**Inspirations:** Notion (UI/UX), GitHub (collaboration/tracking), Google AI Studio, NotebookLM.

---

## 2. Development Philosophy: Parallel Tracks

Development does not follow strict sequential phases. We operate on **parallel tracks** and pivot based on product needs:

- **Track A — The Core Study Engine:** Hybrid UX (chat bubbles, contextual pop-ups, PDF/code rendering, text-selection actions).
- **Track B — The AI Agents Marketplace** (`ai-study-agents.com`): A future sub-platform of specialized expert Personas (Strict Code Reviewer, Statistics TA, CV Expert, etc.). Users import these into the main learning hub.
- **Track C — The Study Commons:** Social/community layer. Students share summaries, upvote content, and contribute to a globally deduplicated knowledge base.
- **Track D — The Personal Academic Hub:** Private dashboard (GPA calculator, job application tracker, CV storage, contribution graph).

---

## 3. Product Pillars

### Hybrid UX (Chat + App)
Users should not have to type long prompts for common tasks. The UI offers context-aware buttons, floating toolbars, and quick-actions (e.g., "Explain this formula") that trigger complex AI behaviors.

### Contextual Precision (Anti-Hallucination)
The AI must be grounded in *authentic* course material. A Persona only relies on the specific lectures, exams, and transcripts relevant to the student's exact context — mimicking the real expectations of a specific professor.

### Long-Term Learning Continuity
The system remembers the student across semesters. Struggled with a concept in Year 1? The AI uses that context when explaining advanced topics in Year 3.

### Deduplication & The Commons
If 500 students upload the same syllabus, it's processed once. Collective insights, chats, and summaries anchor to a single base document. (Implemented today via the multi-tenant CAS pipeline — see `SYSTEM_ARCHITECTURE.md` §7.)

### Personalization & Belonging
The platform is highly customizable. It should feel clean, uncluttered, yet deeply personal — avoiding the generic, cold feel of standard AI chat interfaces.

---

## 4. Default Personas (NotebookLM-style)

Four built-in personas ship without setup:

1. **Study Assistant** — NotebookLM-style. Primary RAG target is the user's *Personal Meta-Data Namespace* (see §5). Answers questions like "How will an A in Math affect my GPA?" grounded in the user's own curriculum and university rules.
2. **Private Tutor** — Adaptive, Socratic teaching style for deep topic mastery.
3. **Academic Researcher** — Citation-aware, academic-tone summarizer and literature navigator.
4. **Industry Mentor** — Career advice, job application review, technical interview prep.

---

## 5. Personal Meta-Data Namespace (Planned)

Every user has a private, dedicated vector store containing their own academic identity:
- Degree curriculum
- Personal transcript
- University regulations
- Exemptions, GPA rules

This namespace is **invisible to other users** and is the exclusive RAG context for the Study Assistant persona. It powers fully personalized, factually-grounded answers without leaking private data into the shared Study Commons.

**Architecture sketch:**
- `UserMetaDocument` table extends `BaseDocument` with a `meta_type` enum (CURRICULUM | TRANSCRIPT | UNIVERSITY_RULES).
- `meta_chunks` table with a `user_id` shard key.
- RAG retrieval filters by `user_id` so no cross-user leakage is possible even when multiple users share the same university's rulebook.

---

## 6. Smart Document Router (Planned)

The transcript-extraction pipeline should operate in two stages **before** any LLM is called:

1. **Template Fingerprinting:** Read the first ~50 words of extracted text. If a known institution signature is detected (e.g., "אוניברסיטת בן-גוריון" / "Ben-Gurion University"), route to a deterministic Python parser (Regex + Pandas) tailored for that layout — 100% accuracy, zero token cost.
2. **LLM fallback:** Only when no template matches, fall through to Gemini for general extraction.

---

## 7. Growth & Gamification (The Moat)

- **Incentives:** Students earn free AI tokens or premium features via referral and high-quality contributed content (summaries, exam solutions).
- **The GitHub Model:** A "Contribution Graph" showcases academic engagement and community help.
- **The LinkedIn Model:** A non-institutional, open-source layer for course reviews, professor ratings, and networking for lab partners or job referrals based on shared academic tracks.

---

## 8. Technical Scalability Roadmap

These technologies are **deliberately deferred** — they add operational complexity not yet justified at current scale. They are recorded so today's decisions don't block tomorrow's adoption.

### Monitoring & Observability
- **Sentry** — Error tracking. SDK placeholder already present in `backend/app/main.py`. Wire when there is real user traffic to debug.
- **Prometheus + Grafana** — Resource monitoring (CPU, memory, latency, DB pool). Deploy when we move beyond a single EC2 instance.

### Performance
- **Redis** — Two use cases: (1) caching expensive AI responses (page summaries, global document summaries); (2) rate-limiting Gemini calls per user. Drop in via `fastapi-limiter`.
- **Celery + RabbitMQ** — Async background queue for long PDF processing (chunking, embedding, LibreOffice conversion). Currently blocking the HTTP request — at scale this must be offloaded.

### AI Ops
- **LangSmith** — Prompt observability and RAG evaluation. Tracks prompt versions, token usage, latency, retrieval quality. Placeholder in `backend/app/core/config.py`. Critical once we tune RAG quality for the Commons.

### Infrastructure as Code
- **Terraform** — Declarative AWS provisioning (EC2, VPC, Security Groups, Elastic IP, S3 backups). Replaces manual AWS console clicks before we add staging + production environments or RDS.
