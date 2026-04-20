# 🏗️ AI Study Partner - System Architecture & Infrastructure

## 1. Project Vision & Core Mechanics
AI Study Partner is an intelligent, RAG-based (Retrieval-Augmented Generation) educational platform. It allows users to upload PDF documents, processes them into semantically searchable chunks, and enables context-aware chat interactions (Threads) directly linked to specific document areas.
A standout feature of the system is "Thread Forking"—a Git-like branching mechanism that allows users to fork a conversation from any specific message, enabling deep dives into sub-topics without losing the context of the original learning thread.

## 2. High-Level Architecture (Monorepo)
The project is structured as a Monorepo, ensuring clear separation of concerns between the client and the server while maintaining a unified repository for version control.

* **Frontend (/ai-study-client):** * **Framework:** React built with Vite for optimal development speed and modern HMR.
  * **Language:** TypeScript for type safety and predictable data structures.
  * **Styling:** TailwindCSS for utility-first, responsive UI design.
  * **State Management:** Strategy pattern via Render Props for UI variations, preparing for lightweight global state.

* **Backend (/backend):** * **Framework:** FastAPI (Python) for high-performance, asynchronous REST API endpoints.
  * **AI/RAG Logic:** Integrates Cloud LLMs (Gemini) and vector embeddings to process and retrieve document contexts efficiently.

## 3. Infrastructure & Containerization
The local development environment and production builds are containerized to guarantee consistency and eliminate "it works on my machine" issues.

* **Docker & Docker Compose:** The database, backend, and frontend are orchestrated together.
* **Database Engine:** PostgreSQL via the official `pgvector/pgvector:pg16` image, enabling native vector storage for embeddings.
* **Volume Management:** Persistent named volumes (`pgdata`) are mapped to ensure data survives container restarts.
* **Security & Env Management:** Database credentials and API keys are strictly decoupled using localized `.env` files.

## 4. Database Design & ORM
* **ORM:** SQLAlchemy handles the Object-Relational Mapping.
* **Vector Storage:** The chunks table utilizes a `Vector(768)` data type to store text embeddings for semantic similarity search.
* **Resolving Circular Dependencies:** The DB schema includes a bidirectional relationship between `Thread` and `Message` (for the forking feature). This architectural challenge was resolved using SQLAlchemy's `use_alter=True` on the Foreign Key definition, allowing the schema to build securely in logical stages.

## 5. Migrations & Schema Evolution (Alembic)
Database state and schema evolutions are strictly managed using Alembic, functioning as the "Git for the database."
* **Automated Migrations:** Replaced dynamic runtime table creation with trackable, deterministic migration scripts.
* **Raw SQL Injection:** Customized Alembic migration scripts to inject raw SQL. Notably, `op.execute('CREATE EXTENSION IF NOT EXISTS vector;')` is executed dynamically before table creation.

---

## 6b. Core Data Flows: Multi-Tenant CAS Architecture

### The CAS Pipeline — How a File Upload Works

```
User uploads file.pdf
       │
       ▼
1. Backend computes SHA-256 hash of raw file bytes → hash_id = "a3f7c2..."
       │
       ├── hash_id EXISTS in basedocuments?
       │         │
       │         YES → skip re-processing (deduplication)
       │         NO  → INSERT INTO basedocuments
       │               (hash_id, original_filename, file_path, source_type="UPLOAD",
       │                doc_type="GENERAL", global_summary=null, metadata={})
       │               → chunk + embed → INSERT INTO chunks (base_hash=hash_id)
       │
       ▼
2. Always INSERT INTO userdocuments
   (user_id, base_hash=hash_id, custom_title=filename, is_public=false)
   → returns UserDocument.id to the frontend as the "document id"
```

### Table Ownership Model

| Table            | Belongs To   | Key Field              | Notes                                        |
|------------------|-------------|------------------------|----------------------------------------------|
| `basedocuments`  | Content      | `hash_id` (SHA-256)    | 1 row per unique file, shared across users   |
| `userdocuments`  | User         | `id` (Integer PK)      | 1 row per (user, file) pair                  |
| `chunks`         | Content      | `base_hash` → basedoc  | Embeddings shared; no re-indexing on clone   |
| `page_summaries` | Content      | `base_hash` → basedoc  | AI summaries cached at content level         |
| `threads`        | User         | `document_id` → userdoc | Conversations are private per workspace      |
| `study_sessions` | User         | `document_id` → userdoc | Session state is per user                    |

### Future-Proofing Fields

- **`source_type`** (`UPLOAD` | `DRIVE` | `MOODLE`): The ingestion path. Future integrations
  (Google Drive sync, Moodle LTI) create `BaseDocument` rows with the appropriate source type
  without changing any downstream table.
- **`doc_type`** (`GENERAL` | `SYLLABUS` | `EXAM_RAW` | `EXAM_PROCESSED` | `LECTURE_TRANSCRIPT`):
  Enables type-specific RAG pipelines. A `SYLLABUS` triggers course-structure parsing;
  an `EXAM_RAW` can be linked to its processed version via `parent_hash`.
- **`parent_hash`** (self-FK on `basedocuments`): Links derivative content back to its origin —
  e.g., a cleaned `EXAM_PROCESSED` document back to the raw scan, or a `LECTURE_TRANSCRIPT`
  to the source video file.
- **`metadata`** (JSONB, default `{}`): Schema-free tags for Course, Degree, University,
  Language, Year — queryable without schema migrations.
- **`ai_feedback`** (JSONB on `userdocuments`): Per-user ratings/corrections on AI summaries,
  feeding a future reinforcement-learning loop.
- **`folder_id`** (Integer FK on `userdocuments` → `folders.id`): Organises documents into
  course/subject containers. NULL = "unfiled" (top-level library view).
- **`is_starred`** (Boolean on `userdocuments`): User-level bookmark; surfaced at top of library.

---

## 6c. Folder / Course Architecture

### Data Model

```
folders
  id          INTEGER PK
  user_id     → users.id
  name        VARCHAR    (e.g. "Algorithms 2025", "Linear Algebra")
  color       VARCHAR    (hex or Tailwind token for UI theming, nullable)
  is_starred  BOOLEAN    default false — pinned folders sort first
  persona_id  → personas.id  (default AI persona for this course, nullable)
  created_at  TIMESTAMPTZ

userdocuments
  ...
  folder_id   → folders.id  (nullable — NULL means unfiled)
  is_starred  BOOLEAN       default false — bookmarked documents
```

### CRUD API

| Method | Route                                  | Description                                       |
|--------|----------------------------------------|---------------------------------------------------|
| GET    | /api/v1/folders/                       | List caller's folders (starred first, then alpha) |
| POST   | /api/v1/folders/                       | Create a folder                                   |
| PUT    | /api/v1/folders/{id}                   | Update name / color / is_starred / persona_id     |
| DELETE | /api/v1/folders/{id}                   | Delete; sets folder_id=NULL on all its documents  |
| PATCH  | /api/v1/documents/{id}/folder          | Move document to a folder (null = unfiled)        |

### Delete Safety

Deleting a Folder does **not** delete its documents. The router issues:

```sql
UPDATE userdocuments SET folder_id = NULL WHERE folder_id = :folder_id
```

before removing the folder row — documents become "unfiled" rather than orphaned.

### Design Rationale

- Integer PK (not UUID) — consistent with all other PKs in the schema.
- `persona_id` on `Folder` lets a course pre-configure its AI tutor (e.g. "BGU DS TA" for a
  Data Structures folder), which the PreFlightModal can inherit when a user opens any document
  inside that folder.
- `is_starred` lives on both `Folder` and `UserDocument` independently — a user can star a
  single document without starring its whole folder.

---

## 7. Architecture Decision Records (ADRs) & Trade-offs

This section documents the engineering dilemmas faced during development and the rationale behind the chosen solutions.

### ADR 1: Local AI Models vs. Cloud API (LLM)
* **The Dilemma:** Initially, the system utilized local models via LM Studio and HuggingFace libraries (`langchain-huggingface`) to generate thread titles, emojis, and handle chat completions. 
* **The Problem:** Running heavy ML libraries (like PyTorch) alongside a FastAPI server within a Docker container on WSL2 led to severe memory bottlenecks and Out-Of-Memory (OOM) crashes on standard machines (limited to 4GB RAM).
* **The Decision:** **Migrate to Cloud API (Google Gemini).**
* **Trade-offs:** * *Pros:* Drastically reduced backend memory footprint (enabling cheap VPS deployment), eliminated OOM crashes, lightning-fast container build times (sub 30 seconds).
  * *Cons:* Vendor lock-in to Google's API, dependency on internet connectivity, and potential rate-limiting. To mitigate rate limits, we implemented DB caching for generated summaries.

### ADR 2: The Embeddings Engine
* **The Dilemma:** How to convert document chunks into vectors for semantic search without exhausting server resources?
* **Options Considered:**
  1. **HuggingFace (`sentence-transformers`):** Excellent local control, but pulls massive PyTorch dependencies. Rejected due to RAM constraints.
  2. **ONNX Runtime:** A lightweight local alternative running on CPU. Good for privacy, but requires maintaining separate models.
  3. **Cohere API:** A strong cloud alternative, but introduces a second API key and vendor to manage.
  4. **Google Gemini Embeddings API (`text-embedding-004`):** Generates 768-dimension vectors natively. 
* **The Decision:** **Google Gemini Embeddings API.**
* **Trade-offs:** We accepted the reliance on Google's Free Tier quotas. However, Google provides a generous limit for embeddings (up to 1,500 Requests Per Minute). Since LangChain batches chunk processing, we can efficiently process hundreds of PDF pages per minute without hitting the ceiling, resulting in a zero-RAM-cost embedding pipeline.

### ADR 3: Vector Search Calculation (Scikit-Learn vs. pgvector)
* **The Dilemma:** How to calculate Cosine Similarity between the user's query and the document chunks.
* **The Decision:** **Migrate from in-memory processing (`scikit-learn` & `numpy`) to native database execution (`pgvector`).**
* **Trade-offs:** Pulling thousands of vectors into the Python RAM to calculate similarity using `sklearn` is an anti-pattern for large datasets. By offloading the math to PostgreSQL (`ORDER BY embedding <=> query_vector`), we keep the FastAPI application completely stateless and highly scalable, despite the slight overhead of learning advanced SQLAlchemy syntax for vector queries.


### ADR 4: Cloud Infrastructure & Deployment Provider
* **The Dilemma:** Choosing a cloud provider to host the production-ready application (FastAPI, React, PostgreSQL) via Docker Compose. The goal is to maximize learning outcomes and align with industry standards while maintaining cost-efficiency.
* **Options Considered:**
  1. **DigitalOcean:** Excellent developer experience, straightforward pricing, but less ubiquitous in enterprise environments.
  2. **AWS (EC2 Free Tier - t2.micro/t3.micro):** The undisputed industry standard for cloud computing. Offers a 1-year free tier but comes with a steep learning curve and a rigid 1GB RAM limit.
  3. **GCP/Azure:** Strong enterprise alternatives, but AWS provides the most universally recognized baseline for infrastructure skills.
* **The Decision:** **AWS (Amazon Web Services) - EC2 Instance.**
* **Trade-offs:** * *Pros:* Direct exposure to industry-standard DevOps tools (IAM, Security Groups, Elastic IPs). High value for resume building and interview discussions.
  * *Cons:* The 1GB RAM limitation of the free tier poses a risk when running multiple Docker containers (PostgreSQL + API + Nginx).
  * *Mitigation:* To prevent Out-Of-Memory (OOM) kills during Docker builds and database operations, we will manually configure a Linux Swap File to offload idle memory pages to the SSD, utilizing OS-level memory management to bypass hardware limitations.

  ## 6. Frontend Architecture & User Experience (UX)

### Directory Structure (Domain-Driven Design)
The frontend follows a feature-based DDD layout. Shared infrastructure (layout, hooks, store, types) lives at `src/`, while domain components are isolated under `src/features/`:

```
ai-study-client/src/
├── features/
│   ├── personas/components/   # PersonaLab, PersonaEditor, PublicGallery, SwitchPersonaModal
│   ├── chat/components/       # ChatPanel, BreadcrumbTree, MillerColumnsTree, NodeGraphTree
│   ├── documents/components/  # PdfViewer, FileUploadView, DocumentPicker
│   └── sessions/components/   # PreFlightModal, SessionWrapUpModal, ResumeToast
├── components/
│   ├── layout/                # AppLayout, MainWorkspace, Sidebar, PageContainer, PageHeader …
│   └── ui/                    # AuthModal, ConfirmModal …
├── data/
│   └── mocks/                 # mockPersonas.ts (dev/test data only)
├── hooks/                     # useAuth, useDocuments, useChat
├── store/                     # useAppStore (Zustand)
├── services/                  # api.ts
└── types/                     # index.ts, persona.ts
```

* **UI Tree Variations:** The Thread Forking feature required a flexible UI. We designed three distinct approaches to display the conversation tree (Node Graph, Miller Columns, Breadcrumbs). This was implemented using the **Strategy Pattern** combined with React Render Props, allowing the user to dynamically toggle between views without altering the underlying data structure.
* **Document Context & Scroll Spy:** To enhance the learning experience, the UI includes a precise "Scroll Spy" mechanism for the PDF viewer, ensuring the chat context is always visually synced with the user's reading position.
* **State & Route Guarding:** `App.tsx` serves as a strict gatekeeper. Unauthenticated users are isolated to the landing page, preventing unauthorized access to the application state or API endpoints.

## 7. Extended Architecture Decision Records (ADRs)

### ADR 5: LLM Token Cost Management & Latency
* **The Dilemma:** Generating page-by-page summaries for entire PDF documents upon upload is highly resource-intensive, slow, and rapidly depletes API token quotas.
* **The Decision:** **Implement a "Gatekeeper" pattern with Lazy Loading and Database Persistence.**
* **Trade-offs:** * *Pros:* Massive reduction in token consumption and initial load times. Summaries are fetched on-demand (Lazy Loading) with upfront cost estimations and explicit user approval. Furthermore, generated summaries are saved (persisted) in a dedicated PostgreSQL table, meaning returning users access them instantly with zero API cost.
    * *Cons:* Increased backend complexity, requiring new DB tables and caching logic.

### ADR 6: Authentication & "Showcase" Mode
* **The Dilemma:** For a portfolio project, requiring strict user registration creates friction for recruiters and reviewers, yet open endpoints expose the system to abuse.
* **The Decision:** **Frontend-driven Guest/Demo Mode backed by FastAPI JWT.**
* **Trade-offs:** Instead of complex backend seeding scripts, the frontend attempts to log in a predefined "Demo User". If it doesn't exist, it registers it automatically behind the scenes. This provides a frictionless "One-Click Showcase" experience while keeping the backend endpoints fully secured and guarded by JWT authentication.

### ADR 7: API Call Optimization (Zero-Shot Classification)
* **The Dilemma:** Generating a title and assigning an appropriate Emoji for each new chat thread initially required multiple, sequential API calls to the LLM, causing noticeable UI delays.
* **The Decision:** **Unified JSON-formatted prompt mapping.**
* **Trade-offs:** We transitioned to a single, highly engineered Zero-Shot prompt that forces the Gemini API to return both the title and the emoji in a strictly typed JSON format in one go. This cut API latency in half but required stricter error handling for JSON parsing on the backend.

### ADR 8: Backend Resource Management (Garbage Collection)
* **The Dilemma:** Users uploading files and deleting threads can leave orphaned PDF files taking up valuable disk space on the AWS server.
* **The Decision:** **Automated Server-Side Garbage Collector.**
* **Implementation:** Developed a mechanism alongside a centralized Document Library (to prevent duplicate uploads). The GC routinely cleans up orphaned files that are no longer referenced in the database, ensuring the 8GB AWS storage remains healthy.

### ADR 9: Security, Routing & Web Server (DevOps Phase)
* **The Dilemma:** How to securely expose the Dockerized application to the public internet on AWS, assign a custom domain, and handle SSL termination without creating conflicts between Docker containers and Let's Encrypt (`certbot`).
* **The Decision:** **Cloudflare Proxy + Nginx Reverse Proxy with Host-Level Certbot.**
* **Implementation & Trade-offs:** * *Domain Strategy:* Purchased a pristine `.com` domain and utilized **Defensive Domain Registration** (purchasing the plural variant) to protect the brand and redirect typos.
    * *SSL Strategy:* Executed Certbot in `standalone` mode on the AWS Host (briefly freeing port 80). The generated SSL certificates were then mapped into the Nginx container using **Read-Only (`ro`) Docker Volumes**.
    * *Security:* Enabled Cloudflare's **Full (Strict) SSL** and Proxy (Orange Cloud) to shield the actual AWS IP, prevent DDoS attacks, and enforce automatic HTTP to HTTPS redirection (301) via Nginx. This creates an industry-standard, production-grade security pipeline, albeit with a more complex deployment workflow.

---

## 8. Future Roadmap: Phase 2 (AI Agents Marketplace)

**Objective:** Evolve the single-agent learning tool into a role-based educational platform.

* **Architecture (Separation of Concerns):** We will utilize our secondary, defensively registered domain (`ai-study-agents.com`) to build a fast, lightweight Static Site (SSG) acting as a visual catalog/marketplace of "Expert Tutors" (e.g., Data Engineering Mentor, Math Tutor).
* **The Handshake:** When a user selects a persona from the catalog, they will be seamlessly redirected to the main application engine (`ai-study-agent.com`) via URL Query Parameters (e.g., `?persona=data_engineer`).
* **Dynamic Context Injection:** The main FastAPI backend will intercept the parameter, retrieve the corresponding deep System Prompt from the database, and initialize the Gemini chat session strictly within the boundaries of that specific professional persona. This keeps the core app engine generic and highly scalable.

### ADR 10: Drive UI — Folder-First Library

* **The Problem:** A flat document list doesn't scale past ~20 files; users can't organise material by subject.
* **The Decision:** Redesign `MyLibrary` as a two-level Drive-style workspace with a **Courses** (folders) section above a **Files** section.
* **Key Design Choices:**
  * Root shows *unfiled* documents; clicking a folder filters to that folder's documents only (mirroring Google Drive navigation rather than a tag-based view).
  * `Folder.persona_id` lets a course pre-configure its AI tutor; `FolderModal` exposes a dropdown for this.
  * Star state lives on both `Folder` and `UserDocument` independently — starring a file doesn't star its folder.
  * Optimistic updates for star toggles with automatic rollback on API failure.
* **New frontend modules:** `useFolders` hook, `FolderCard`, `FolderGrid`, `FolderModal`, `MoveToFolderModal`.

### ADR 10b: Office Document Support (DOCX + PPTX → PDF via LibreOffice)

* **The Problem:** Users want to upload Word (`.docx`) and PowerPoint (`.pptx`) alongside PDFs. `react-pdf` cannot render Office binary formats — so a server-side conversion to PDF is needed before the file is served to the frontend.
* **The Decision:** Convert `.docx`/`.pptx` → PDF using **LibreOffice headless** at upload time. `BaseDocument.file_path` is set to the converted PDF path; the frontend always receives a PDF blob URL and renders it through the existing `<PdfViewer />` unchanged.
* **Key Implementation Details:**
  * `libreoffice`, `fonts-liberation`, and `fonts-dejavu-core` added to `Dockerfile.backend` via `apt-get`.
  * `convert_to_pdf(input_path, output_dir)` runs LibreOffice as a subprocess with a 120-second timeout; raises `RuntimeError` (caught by the router as HTTP 500) if the exit code is non-zero or the expected output file is missing.
  * **Text extraction order (important for RAG quality):**
    * `.docx` → `extract_text_from_word` (python-docx, paragraph-level accuracy) → then convert to PDF for display.
    * `.pptx` → convert to PDF first (no raw extractor) → `extract_text_from_pdf` on the converted PDF.
  * `doc_type = "GENERAL"` for both formats; `original_filename` keeps the original extension for display, while `file_path` stores the PDF for serving.
  * `ACCEPTED_FILE_TYPES` in `fileIcons.tsx` now includes `.pptx`; `Presentation` icon (orange) added to the icon map.
  * `WordViewer.tsx` removed — the backend now guarantees a PDF is always available for GENERAL documents.

### ADR 10c: Smart File-Type Icons (FileIcon utility)

* **The Problem:** A flat library with only a generic `FileText` icon gives no visual distinction between PDFs, Word docs, and code files.
* **The Decision:** Introduce `src/utils/fileIcons.tsx` — a single source of truth that maps file extensions to Lucide icons and Tailwind color classes.
* **Icon mapping:**
  | Extension | Icon | Color |
  |-----------|------|-------|
  | `.pdf` | `FileText` | `text-rose-500` |
  | `.docx` / `.doc` | `FileText` | `text-blue-500` |
  | `.pptx` / `.ppt` | `Presentation` | `text-orange-500` |
  | code files | `FileCode` | `text-amber-500` |
  | other | `File` | `text-slate-400` |
* **Consumers:** `DocCard` (MyLibrary grid), `DocumentPicker` dropdown, `WorkspaceHeader` title bar. Each consumer decides whether to use the full color (DocCard) or override with its own context color (DocumentPicker active state, WorkspaceHeader gray).

### ADR 10d: Code Learning Environment (Monaco Editor + doc_type routing)

* **The Problem:** Source code files (`.py`, `.ts`, `.js`, etc.) are meaningless when rendered through `react-pdf`; they need syntax highlighting, a monospace font, and code-aware selection actions.
* **The Decision:** Introduce a `doc_type` field (`GENERAL` | `SOURCE_CODE`) on `BaseDocument`. On upload the backend determines `doc_type` from the file extension. On the frontend, `MainWorkspace` switches between `<PdfViewer>` and `<CodeViewer>` based on `doc.docType`.
* **Key Implementation Details:**
  * `CODE_EXTENSIONS` frozenset in `document_service.py` — single source of truth for supported code types.
  * `extract_text_from_code` wraps the file in a header line (`=== File: filename ===`) so the LLM always has filename context in RAG retrieval.
  * `generate_code_summary` uses a Software Architect system prompt (distinct from the PDF summary prompt).
  * `CodeViewer` is built on `@monaco-editor/react` with `readOnly: true` and bracket-pair colorisation. Language is detected from the filename extension via `LANGUAGE_MAP`.
  * Text selection fires `onDidChangeCursorSelection`; pixel position is resolved via `getScrolledVisiblePosition` (cast to `any` — not in public Monaco types) with a container-center fallback. Selected text is pushed to Zustand `textSelection`, identical to the PDF flow, so ChatPanel and thread creation work unchanged.
  * The floating action menu shows code-specific smart actions (Explain / Find bugs / Refactor) above the standard quick actions row.
* **New modules:** `CodeViewer.tsx` (`features/documents/components/`). No new hooks required — `useDocuments.docType` memo feeds the prop.

### ADR 10e: RTL Language Support (Hebrew PDF Extraction)
* **The Dilemma:** Standard PDF parsers (like `PyPDF2`) extract Right-To-Left (RTL) languages backward or as gibberish because PDFs store visual coordinate data rather than logical text flow.
* **Options Considered:** 1. Stick to basic parsers and accept degraded Hebrew support.
  2. Implement advanced parsers (`PyMuPDF` / `pdfplumber`) combined with NLP libraries (`python-bidi`) to logically reverse and clean the text.
* **The Planned Decision:** **Advanced Parsing with Bidi processing.**
* **Trade-offs:** * *Pros:* Perfect Hebrew extraction, ensuring the LLM receives accurate context for semantic search and summarization.
  * *Cons:* Slightly increased backend processing time and additional library dependencies during the document upload phase.

### ADR 11: Multi-Modal RAG (Handling Images, Graphs, and Formulas)
* **The Dilemma:** Standard RAG pipelines only extract raw text. Complex educational PDFs containing mathematical formulas, architecture diagrams, and charts lose their critical context during the chunking phase.
* **Options Considered:**
  1. **OCR (Tesseract):** Easy to implement but structural context (like formulas or graph nodes) is completely destroyed.
  2. **Layout Parsers (Nougat / Unstructured.io):** Excellent for scientific papers (converts formulas to LaTeX), but heavily relies on GPU acceleration, which is incompatible with our cost-effective AWS free-tier hosting.
  3. **Vision LLMs (Gemini 1.5 Pro Vision):** Passing the entire page as an image to the LLM. Perfect understanding, but drastically increases token costs and API latency.
* **The Planned Decision:** **Hybrid Pipeline (Text + Object Detection + Targeted Vision RAG).**
* **Implementation Strategy:** The backend will first extract standard text. Simultaneously, an object detection utility will identify bounding boxes for images/graphs. Only these specific cropped images will be sent to the Vision LLM to generate textual descriptions ("Image of X..."). These descriptions are then injected into the database chunks as standard text.
* **Trade-offs:** Maximizes semantic understanding and accuracy for complex documents while optimizing token costs, though it significantly increases the complexity of the document processing pipeline.

### ADR 12: Multi-Format Document Support (Word, PPTX, CSV)
* **The Dilemma:** Users will eventually want to upload formats other than PDF (e.g., PowerPoint, Word). However, browsers cannot natively or uniformly render these complex formats alongside our React-based chat UI without heavy, inconsistent third-party wrappers.
* **The Planned Decision:** **Server-Side Conversion to PDF.**
* **Trade-offs:** * *Pros:* Solves all Frontend rendering issues. The UI remains clean, unified, and exclusively reliant on `react-pdf`. Coordinates for "Floating Comments" and text selection remain predictable.
  * *Cons:* Requires a background conversion engine on the backend (e.g., `u