import os
import shutil
import signal
from time import time
from typing import List
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from database import engine, get_db, SessionLocal
import models, schemas, services

# ==========================================
# 1. Lifespan & App Initialization
# ==========================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- מה שקורה לפני שהשרת מתחיל לקבל בקשות (Startup) ---
    print("🔄 [Startup] Running file-system reconciliation...")
    db = SessionLocal()
    try:
        valid_docs = db.query(models.Document.file_path).all()
        valid_paths = {doc.file_path for doc in valid_docs}
        
        uploads_dir = "uploads"
        deleted_count = 0
        
        if not os.path.exists(uploads_dir):
            os.makedirs(uploads_dir)
            print("📁 Created 'uploads' directory.")
        else:
            for filename in os.listdir(uploads_dir):
                full_path = f"{uploads_dir}/{filename}"
                
                if full_path not in valid_paths:
                    try:
                        os.remove(full_path)
                        deleted_count += 1
                    except Exception as e:
                        print(f"⚠️ Failed to delete orphaned file {full_path}: {e}")
                        
        if deleted_count > 0:
            print(f"🧹 [Startup] Cleanup complete: Deleted {deleted_count} orphaned files.")
        else:
            print("✨ [Startup] File-system is perfectly synced with DB.")
            
    finally:
        db.close()
    
    # --- השרת עולה ---
    yield
    
    # --- Shutdown ---
    print("🛑 [Shutdown] Server is shutting down cleanly...")

# כאן אנחנו מגדירים את ה-APP פעם אחת בלבד!
app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], 
    allow_credentials=True,
    allow_methods=["*"], 
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# ==========================================
# 2. Routes: Health & Users
# ==========================================

@app.get("/health")
def health_check():
    is_connected, message = services.check_llm_connection()
    if not is_connected:
        raise HTTPException(status_code=503, detail=message)
    return {"status": "ok", "message": message}

@app.post("/users/", response_model=schemas.UserResponse)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    new_user = models.User(email=user.email, password_hash=user.password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


# ==========================================
# 3. Routes: Documents & Pages
# ==========================================

@app.get("/documents/user/{user_id}", response_model=List[schemas.DocumentResponse])
def get_user_documents(user_id: int, db: Session = Depends(get_db)):
    documents = db.query(models.Document)\
                  .filter(models.Document.user_id == user_id)\
                  .order_by(models.Document.created_at.desc())\
                  .all()
    return documents

@app.post("/documents/", response_model=schemas.DocumentResponse)
def upload_document(
    user_id: int,
    file: UploadFile = File(...),
    generate_summary: bool = Form(False),
    db: Session = Depends(get_db)
):
    file_location = f"uploads/{file.filename}"
    with open(file_location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    pages_data = services.extract_text_from_pdf(file_location)
    full_text_for_summary = "\n".join([p['text'] for p in pages_data])
    
    root_summary = None
    if generate_summary:
        print("🚀 [Token Alert] Generating FULL document summary via Gemini...")
        raw_summary = services.generate_document_summary(full_text_for_summary)
        
        if isinstance(raw_summary, list):
            extracted_texts = [item.get('text', '') for item in raw_summary if isinstance(item, dict) and item.get('type') == 'text']
            root_summary = "\n\n".join(extracted_texts)
        elif not isinstance(raw_summary, str):
            root_summary = str(raw_summary)
        else:
            root_summary = raw_summary
    else:
        print("🤫 Skipping global summary (Tokens saved!).")

    new_doc = models.Document(
        title=file.filename,
        file_path=file_location,
        user_id=user_id,
        summary=root_summary
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)

    embedding_model = services.get_embedding_model()
    chunk_counter = 0
    print("🧩 Processing pages into chunks...")
    
    for page in pages_data:
        page_chunks_text = services.split_text_into_chunks(page['text'])
        if not page_chunks_text:
            continue
            
        vectors = embedding_model.embed_documents(page_chunks_text)
        
        for i, chunk_text in enumerate(page_chunks_text):
            vector_data = vectors[i].tolist() if hasattr(vectors[i], "tolist") else vectors[i]
            new_chunk = models.Chunk(
                document_id=new_doc.id, text=chunk_text, chunk_index=chunk_counter,
                page_number=page['page_number'], embedding=vector_data
            )
            db.add(new_chunk)
            chunk_counter += 1
            
    db.commit()
    print(f"✅ Saved {chunk_counter} chunks!")
    return new_doc


@app.get("/documents/{document_id}/pages/{page_number}/estimate-summary")
def estimate_page_summary_tokens(document_id: int, page_number: int, db: Session = Depends(get_db)):
    page_chunks = db.query(models.Chunk).filter(
        models.Chunk.document_id == document_id,
        models.Chunk.page_number == page_number
    ).all()
    
    if not page_chunks:
        raise HTTPException(status_code=404, detail="Page not found or empty")
        
    page_text = "\n".join([c.text for c in page_chunks])
    prompt_preview = f"Summarize the following in Hebrew:\n{page_text}" 
    token_count = services.count_tokens_in_text(prompt_preview)
    
    return {"tokens": token_count, "page_number": page_number}


@app.post("/documents/{document_id}/pages/{page_number}/summary")
def create_page_summary(document_id: int, page_number: int, db: Session = Depends(get_db)):
    page_chunks = db.query(models.Chunk).filter(
        models.Chunk.document_id == document_id,
        models.Chunk.page_number == page_number
    ).all()
    
    if not page_chunks:
        raise HTTPException(status_code=404, detail="Page not found")
        
    page_text = "\n".join([c.text for c in page_chunks])
    
    print(f"🪙 [Gemini API] Generating summary for Document {document_id}, Page {page_number}...")
    summary_result = services.generate_specific_page_summary(page_text)
    
    return {"summary": summary_result}


# ==========================================
# 4. Routes: Threads & Messages
# ==========================================

@app.get("/documents/{document_id}/threads/", response_model=List[schemas.ThreadResponse])
def get_document_threads(document_id: int, db: Session = Depends(get_db)):
    threads = db.query(models.Thread).filter(models.Thread.document_id == document_id).all()
    for thread in threads:
        thread.messages = services.get_full_thread_history(thread.id, db)
    return threads

@app.get("/threads/{thread_id}", response_model=schemas.ThreadResponse)
def get_single_thread(thread_id: int, db: Session = Depends(get_db)):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    thread.messages = services.get_full_thread_history(thread.id, db)
    return thread

@app.post("/threads/", response_model=schemas.ThreadResponse)
def create_thread(thread_data: schemas.ThreadCreate, db: Session = Depends(get_db)):
    matched_emoji = services.classify_text_to_emoji(thread_data.selected_text or "")
    new_thread = models.Thread(
        document_id=thread_data.document_id,
        page_number=thread_data.page_number,
        selected_text=thread_data.selected_text,
        coordinates=thread_data.coordinates,
        emoji=matched_emoji,
        title=None 
    )
    db.add(new_thread)
    db.commit()
    db.refresh(new_thread)
    return new_thread

def update_thread_title_background(thread_id: int, prompt: str, selected_text: str, db: Session):
    new_title = services.generate_thread_title_local(prompt, selected_text)
    if new_title and new_title != "שיחה חדשה":
        thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
        if thread:
            thread.title = new_title
            db.commit()

@app.post("/threads/{thread_id}/messages/", response_model=schemas.MessageResponse)
def add_message_to_thread(
    thread_id: int, 
    message: schemas.MessageCreate, 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db)
):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
        
    user_msg = models.Message(thread_id=thread_id, role="user", content=message.content)
    db.add(user_msg)
    db.commit()
    
    history_in_db = db.query(models.Message).filter(models.Message.thread_id == thread_id).all()
    if len(history_in_db) == 1: 
        context_for_ai = f"{thread.selected_text} | {message.content}"
        thread.emoji = services.classify_text_to_emoji(context_for_ai)
        db.commit()
        
        background_tasks.add_task(
            update_thread_title_background, 
            thread_id, 
            message.content, 
            thread.selected_text, 
            db
        )

    doc = db.query(models.Document).filter(models.Document.id == thread.document_id).first()
    full_history = services.get_full_thread_history(thread_id, db)
    all_chunks = db.query(models.Chunk).filter(models.Chunk.document_id == thread.document_id).all()
    page_chunks = db.query(models.Chunk).filter(
        models.Chunk.document_id == thread.document_id,
        models.Chunk.page_number == thread.page_number
    ).all()
    current_page_text = "\n".join([c.text for c in page_chunks])
    
    ai_response = services.get_chat_response_for_thread(
        history=full_history, 
        selected_text=thread.selected_text,
        root_summary=doc.summary,
        doc_chunks=all_chunks,
        current_page_text=current_page_text
    )
    
    ai_msg = models.Message(thread_id=thread_id, role="assistant", content=ai_response)
    db.add(ai_msg)
    db.commit()
    db.refresh(ai_msg)
    return ai_msg

@app.post("/threads/{thread_id}/fork/", response_model=schemas.ThreadResponse)
def fork_thread(thread_id: int, message_id: int, db: Session = Depends(get_db)):
    parent_thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not parent_thread:
        raise HTTPException(status_code=404, detail="Parent thread not found")

    new_thread = models.Thread(
        document_id=parent_thread.document_id,
        page_number=parent_thread.page_number,
        selected_text=parent_thread.selected_text,
        coordinates=parent_thread.coordinates,
        parent_thread_id=parent_thread.id,  
        forked_from_message_id=message_id,   
        emoji=parent_thread.emoji
    )
    db.add(new_thread)
    db.commit()
    db.refresh(new_thread)

    new_thread.messages = services.get_full_thread_history(new_thread.id, db)

    return new_thread


# ==========================================
# 5. System Routes
# ==========================================

def kill_server_logic():
    print("💀 Shutting down Backend process...")
    time.sleep(1) 
    os.kill(os.getpid(), signal.SIGTERM)

@app.post("/system/shutdown")
def shutdown_system(background_tasks: BackgroundTasks):
    background_tasks.add_task(kill_server_logic)
    return {"message": "System is shutting down..."}