🏗️ AI Study Partner - System Architecture & Infrastructure
1. Project Vision & Core Mechanics
AI Study Partner is an intelligent, RAG-based (Retrieval-Augmented Generation) educational platform. It allows users to upload PDF documents, processes them into semantically searchable chunks, and enables context-aware chat interactions (Threads) directly linked to specific document areas.
A standout feature of the system is "Thread Forking"—a Git-like branching mechanism that allows users to fork a conversation from any specific message, enabling deep dives into sub-topics without losing the context of the original learning thread.

2. High-Level Architecture (Monorepo)
The project is structured as a Monorepo, ensuring clear separation of concerns between the client and the server while maintaining a unified repository for version control.

Frontend (/ai-study-client): * Framework: React built with Vite for optimal development speed and modern HMR.

Language: TypeScript for type safety and predictable data structures.

Styling: TailwindCSS for utility-first, responsive UI design.

State Management: Zustand (planned) for lightweight, predictable global state.

Backend (/backend): * Framework: FastAPI (Python) for high-performance, asynchronous REST API endpoints.

AI/RAG Logic: Integrates LLMs and embedding models to process and retrieve document contexts.

3. Infrastructure & Containerization
The local development environment is containerized to guarantee consistency and eliminate "it works on my machine" issues.

Docker & Docker Compose: The database runs exclusively within a Docker container.

Database Engine: PostgreSQL via the official pgvector/pgvector:pg16 image, enabling native vector storage for embeddings.

Volume Management: Persistent named volumes (pgdata) are mapped to ensure data survives container restarts.

Security & Env Management: Database credentials (User, Password, DB Name) are strictly decoupled. Infrastructure configurations are defined directly in docker-compose.yml, while Python application secrets are managed via a localized .env file within the backend directory.

4. Database Design & ORM
ORM: SQLAlchemy handles the Object-Relational Mapping.

Vector Storage: The chunks table utilizes a Vector(768) data type to store text embeddings for semantic similarity search.

Resolving Circular Dependencies: The DB schema includes a bidirectional relationship between Thread and Message (for the forking feature). This architectural challenge (the "chicken-and-egg" problem) was resolved seamlessly using SQLAlchemy's use_alter=True on the Foreign Key definition, allowing the schema to build securely in logical stages.

5. Migrations & Schema Evolution (Alembic)
Database state and schema evolutions are strictly managed using Alembic, functioning as the "Git for the database."

Automated Migrations: Replaced dynamic runtime table creation (Base.metadata.create_all) with trackable, deterministic migration scripts.

Raw SQL Injection: Customized Alembic migration scripts to inject raw SQL during the upgrade process. Notably, op.execute('CREATE EXTENSION IF NOT EXISTS vector;') is executed dynamically before table creation to ensure PostgreSQL recognizes vector types.

Dependency Management: Ensured custom data types (e.g., pgvector.sqlalchemy) are explicitly imported at the head of Alembic version files to prevent runtime scope errors.

6. API Design & Best Practices
The backend adheres to strict RESTful API standards:

Predictable Status Codes: When a client requests a collection (e.g., retrieving threads for a newly uploaded document), the API correctly returns 200 OK with an empty array [], reserving 404 Not Found strictly for cases where the parent resource (the document itself) does not exist. This prevents false positive errors in the Frontend client.

Live Monitoring: Development database monitoring is integrated directly into the IDE using the VS Code SQLTools extension, streamlining the workflow without requiring bulky external DBMS software.