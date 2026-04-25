# AI Study Partner — Product Vision & Ecosystem

## 1. The Core Vision
This is not just a "Chat with PDF" tool. It is the ultimate **Academic Operating System**. We are building a hybrid ecosystem that blends powerful AI capabilities with a highly intuitive, Notion/GitHub-inspired UI. The goal is to provide a unified, highly personalized workspace where students manage their entire academic lifecycle—from deeply analyzing course materials to community collaboration and career prep.

## 2. The Development Philosophy (Parallel Tracks)
Development does not follow strict sequential phases. Instead, we operate on **Parallel Development Tracks**. We can pivot and focus on any track at any given time based on product needs:
* **Track A: The Core Study Engine:** Perfecting the hybrid UX (chat bubbles, contextual pop-ups, PDF/Code rendering, text-selection actions).
* **Track B: The AI Agents Marketplace (`ai-study-agents.com`):** A platform for highly specialized expert Personas (e.g., "Strict Code Reviewer", "Statistics TA", "CV Expert").
* **Track C: The Study Commons (Community & Open Source):** The social/community layer where students share summaries, upvote content, and access a globally deduplicated database of academic knowledge.
* **Track D: The Personal Academic Hub:** The student's private dashboard (GPA calculator, job application tracker, CV storage, personal contribution graph).

## 3. Key Product Pillars
* **Hybrid UX (Chat + App):** Users shouldn't have to type long prompts for everything. The UI should offer context-aware buttons, floating toolbars, and quick-actions (e.g., "Explain this formula") that trigger complex AI behaviors behind the scenes.
* **Contextual Precision (Anti-Hallucination):** The AI must be grounded in the *authentic* course material. A Persona should only rely on the specific lectures, exams, and transcripts relevant to the student's exact context, mimicking the true expectations of the specific professor.
* **Long-Term Learning Continuity:** The system remembers the student across semesters. If a student struggled with a concept in Year 1, the AI uses that context to explain complex topics in Year 3.
* **Deduplication & The Commons:** If 500 students upload the same syllabus, the system processes it once. The collective insights, chats, and summaries are anchored to this single base document, saving resources and building a rich, shared knowledge base.
* **Personalization & Belonging:** The platform is highly customizable. It should feel clean, un-cluttered, yet deeply personal to the student, avoiding the generic, cold feel of standard AI chat interfaces.

## 5. Technical Scalability Roadmap

These technologies are deliberately deferred — they introduce operational complexity that is not justified at the current scale. They are recorded here so architectural decisions today do not block adoption later.

### Monitoring & Observability
* **Sentry** — Error tracking and performance monitoring. SDK placeholder already present in `backend/app/main.py`. Wire when we have real user traffic to debug.
* **Prometheus + Grafana** — Resource monitoring (CPU, memory, request latency, DB connection pool). Deploy alongside the app on AWS when we move beyond a single EC2 instance.

### Performance
* **Redis** — Two use cases: (1) caching expensive AI responses (page summaries, global document summaries); (2) rate limiting the Gemini API calls per user. Drop-in via `fastapi-limiter` or a custom middleware.
* **Celery + RabbitMQ** — Asynchronous background task queue for long-running PDF processing jobs (chunking, embedding, LibreOffice conversion). Currently blocking the HTTP request; at scale this must be offloaded. Celery workers would run as a separate Docker service.

### AI Ops
* **LangSmith** — Prompt engineering observability and RAG pipeline evaluation. Tracks prompt versions, token usage, latency, and retrieval quality scores. API key placeholder present in `backend/app/core/config.py`. Critical once we start tuning RAG quality for the Study Commons.

### Infrastructure as Code
* **Terraform** — Declarative AWS provisioning (EC2, VPC, Security Groups, Elastic IP, S3 for backups). Replaces manual AWS console clicks. Required before we scale to multiple environments (staging + production) or add services like RDS managed PostgreSQL.

---

## 4. Growth & Gamification (The Moat)
* **Incentives:** Students earn free AI tokens or premium features through a "Refer a Friend" system and by contributing high-quality, highly upvoted content (summaries, exam solutions).
* **The GitHub Model:** A "Contribution Graph" (like GitHub's green squares) that showcases a student's academic engagement and community help.
* **The LinkedIn Model:** A non-institutional, open-source layer for course reviews, professor ratings, and networking for lab partners or job referrals based on shared academic tracks.
