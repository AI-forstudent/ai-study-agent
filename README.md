# 🧠 AI Study Partner

*Your Ultimate Intelligent Learning Assistant, powered by Generative AI and RAG.*

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Gemini](https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=google%20gemini&logoColor=white)

## 📖 Overview

**AI Study Partner** is a full-stack, AI-driven educational platform designed to revolutionize how students interact with study materials. Users can upload PDF documents, highlight specific text, and instantly open localized chat threads with an AI tutor. 

The system leverages advanced Retrieval-Augmented Generation (RAG), Zero-Shot classification, and Hybrid AI routing (Cloud + Local) to provide a seamless, highly contextual, and cost-optimized learning experience.

## ✨ Key Features

* **📝 Contextual PDF Interactions:** Highlight any text in a PDF document to trigger smart prompts (Translate, Explain, Quiz) or start an anchored chat thread.
* **🌳 Advanced Thread Management:** * Fork conversations into new branches.
    * Visualize conversation history using multiple UI strategies (Miller Columns, Node Graph, Breadcrumbs).
* **🤖 Hybrid AI Architecture:** * **Cloud (Gemini):** Handles heavy reasoning, deep RAG chat responses, and global document summaries.
    * **Local Models (HuggingFace/LM Studio):** Handles embedding generation and zero-shot topic classification (emoji assignment) to save cloud API costs.
* **🪙 Token-Optimized Page Summaries:** Lazy-loaded page summaries with a built-in token cost estimator and user approval mechanism. Summaries are cached in PostgreSQL for instant retrieval.
* **🔐 Authentication & Showcase Mode:** Secure JWT-based authentication with Bcrypt hashing. Includes a built-in **Guest/Demo Mode** for frictionless portfolio showcases and beta testers.
* **♻️ Smart Resource Management:** Features a built-in Garbage Collector to automatically clean up orphaned files and a document library to prevent duplicate uploads.

## 🛠️ Tech Stack

**Frontend (Client)**
* React 18 + TypeScript + Vite
* Tailwind CSS & Lucide React (UI/UX)
* React-PDF (Document rendering)
* Zustand / Context (State Management)
* Axios with Interceptors (API communication)

**Backend (Server)**
* Python 3 + FastAPI
* PostgreSQL + SQLAlchemy + Alembic (Database & ORM)
* LangChain (LLM Orchestration & RAG pipelines)
* JWT & Bcrypt (Security)
* `uv` (Ultra-fast Python package manager)

## 🚀 Getting Started (Local Development)

### Prerequisites
* Node.js (v18+)
* Python (v3.10+)
* PostgreSQL running locally
* `uv` package manager installed

### 1. Backend Setup
```bash
# Navigate to the backend directory
cd backend # (or your root if mono-repo backend is in root)

# Install dependencies using uv
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
uv pip install -r requirements.txt

# Set up Environment Variables
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY and Database URL

# Run Alembic migrations
alembic upgrade head

# Start the FastAPI server
uv run uvicorn main:app --reload
