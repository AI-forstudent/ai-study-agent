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

* **UI Tree Variations:** The Thread Forking feature required a flexible UI. We designed three distinct approaches to display the conversation tree (Node Graph, Miller Columns, Breadcrumbs). This was implemented using the **Strategy Pattern** combined with React Render Props, allowing the user to dynamically toggle between views without altering the underlying data structure.
* **Document Context & Scroll Spy:** To enhance the learning experience, the UI includes a precise "Scroll Spy" mechanism for the PDF viewer, ensuring the chat context is always visually synced with the user's reading position.
* **State & Route Guarding:** `App.tsx` serves as a strict gatekeeper. Unauthenticated users are isolated to `AuthView.tsx`, preventing unauthorized access to the application state or API endpoints.

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