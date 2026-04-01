import os
import shutil
import signal
from time import time
from typing import List
from contextlib import asynccontextmanager
from sqlalchemy import text
from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from sqlalchemy.orm import Session
from database import engine, get_db, SessionLocal
import models, schemas, services, security, jwt

# ==========================================
# 1. Lifespan & App Initialization
# ==========================================

# קודם כל מדליקים את תוסף הוקטורים בדאטאבייס
with engine.connect() as connection:
    connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    connection.commit()

# רק עכשיו אפשר לייצר את הטבלאות בבטחה
models.Base.metadata.create_all(bind=engine)

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

allowed_origins_str = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
origins_list = [origin.strip() for origin in allowed_origins_str.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://127.0.0.1", "http://localhost:5173", "http://127.0.0.1:5173"],    
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
    
    # התיקון הקריטי: מצפינים את הסיסמה לפני השמירה!
    hashed_pw = security.get_password_hash(user.password)
    new_user = models.User(email=user.email, password_hash=hashed_pw)
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/login/")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # OAuth2PasswordRequestForm משתמש בשדה שנקרא "username", אנחנו נכניס לשם את האימייל
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    
    # בודקים אם המשתמש קיים ואם הסיסמה תואמת להצפנה
    if not user or not security.verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="אימייל או סיסמה שגויים")
    
    # מייצרים את תעודת הזהות הווירטואלית (Token) עם ה-ID של המשתמש
    access_token = security.create_access_token(data={"sub": str(user.id)})
    
    return {"access_token": access_token, "token_type": "bearer"}

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login/")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="לא ניתן לאמת את המשתמש (הטוקן חסר או פג תוקף)",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        # מפענחים את הטוקן
        payload = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        print(f"📦 Decoded Payload: {payload}")
        
        user_id: str = payload.get("sub")
        if user_id is None:
            print("❌ Error: 'sub' (user_id) is missing in payload!")
            raise credentials_exception
            
    except Exception as e:
        # פה נתפוס את השגיאה האמיתית של ההצפנה!
        print(f"❌ JWT Decode Error: {str(e)}")
        raise credentials_exception
        
    # שולפים את המשתמש מהדאטאבייס
    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if user is None:
        print(f"❌ Error: User with ID {user_id} not found in DB!")
        raise credentials_exception
        
    print(f"✅ Success! User validated: {user.email}")
    print(f"---------------------------\n")
    return user

# ==========================================
# 3. Routes: Documents & Pages
# ==========================================


@app.get("/documents/", response_model=List[schemas.DocumentResponse])
def get_user_documents(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    # במקום לקבל user_id מהמשתמש (שאפשר לזייף), אנחנו לוקחים אותו ישירות מ"שומר הסף" (current_user.id)
    documents = db.query(models.Document)\
                  .filter(models.Document.user_id == current_user.id)\
                  .order_by(models.Document.created_at.desc())\
                  .all()
    return documents

@app.post("/documents/", response_model=schemas.DocumentResponse)
def upload_document(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    generate_summary: bool = Form(False),
    persona_id: str = Form(None), # <-- 1. הוספנו קבלת פרמטר מהטופס
    db: Session = Depends(get_db)
):
    # --- הוספת מנגנון הוולידציה (Edge Case 3) ---
    if persona_id:
        persona_exists = db.query(models.Persona).filter(models.Persona.id == persona_id).first()
        if not persona_exists:
            # זורקים שגיאה מסודרת שהפרונטאנד יתפוס ויציג את שני הכפתורים
            raise HTTPException(status_code=404, detail="PERSONA_NOT_FOUND")
    # ---------------------------------------------

    file_location = f"uploads/{file.filename}"
    with open(file_location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
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
        user_id=current_user.id,
        summary=root_summary,
        default_persona_id=persona_id # <-- 2. שומרים את הפרסונה במסמך
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


@app.post("/documents/{document_id}/pages/{page_number}/summary", response_model=schemas.PageSummaryResponse)
def create_page_summary(document_id: int, page_number: int, db: Session = Depends(get_db)):
    # 1. בדיקה: האם הסיכום כבר קיים במטמון (DB)?
    existing_summary = db.query(models.PageSummary).filter(
        models.PageSummary.document_id == document_id,
        models.PageSummary.page_number == page_number
    ).first()

    if existing_summary:
        print(f"♻️ [DB Cache] Returning existing summary for Document {document_id}, Page {page_number}")
        return existing_summary

    # 2. אם לא קיים, שולפים את הטקסט של העמוד
    page_chunks = db.query(models.Chunk).filter(
        models.Chunk.document_id == document_id,
        models.Chunk.page_number == page_number
    ).all()
    
    if not page_chunks:
        raise HTTPException(status_code=404, detail="Page not found")
        
    page_text = "\n".join([c.text for c in page_chunks])
    
    # 3. קריאה לג'ימיני לייצור סיכום חדש
    print(f"🪙 [Gemini API] Generating NEW summary for Document {document_id}, Page {page_number}...")
    summary_result = services.generate_specific_page_summary(page_text)
    
    # 4. שמירה בדאטאבייס לפעם הבאה!
    new_summary = models.PageSummary(
        document_id=document_id,
        page_number=page_number,
        summary=summary_result
    )
    db.add(new_summary)
    db.commit()
    db.refresh(new_summary)
    
    return new_summary

@app.get("/documents/{document_id}/summaries", response_model=List[schemas.PageSummaryResponse])
def get_document_summaries(document_id: int, db: Session = Depends(get_db)):
    summaries = db.query(models.PageSummary).filter(
        models.PageSummary.document_id == document_id
    ).all()
    return summaries

@app.get("/personas/", response_model=List[schemas.PersonaResponse])
def get_all_personas(db: Session = Depends(get_db)):
    """
    ראוט חדש עבור הפרונטאנד: מושך את כל הסוכנים הזמינים מהדאטאבייס
    כדי לאכלס את הרשימה הנפתחת (Dropdown) במסך העלאת המסמך.
    """
    personas = db.query(models.Persona).all()
    return personas

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
    new_thread = models.Thread(
        document_id=thread_data.document_id,
        page_number=thread_data.page_number,
        selected_text=thread_data.selected_text,
        coordinates=thread_data.coordinates,
        emoji="💬",
        title=None,
        persona_id=thread_data.persona_id # <-- שומרים את הפרסונה (אם הועברה)
    )
    db.add(new_thread)
    db.commit()
    db.refresh(new_thread)
    return new_thread

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
        background_tasks.add_task(
            services.generate_thread_metadata_background, 
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
        document_id=thread.document_id, # שינוי: מעבירים רק ID
        db=db,                          # שינוי: מעבירים את הסשן
        current_page_text=current_page_text,
        thread_persona_id=thread.persona_id,
        doc_persona_id=doc.default_persona_id
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
        emoji=parent_thread.emoji,
        persona_id=parent_thread.persona_id # <-- הילד יורש את הסוכן של האבא
    )
    db.add(new_thread)
    db.commit()
    db.refresh(new_thread)

    new_thread.messages = services.get_full_thread_history(new_thread.id, db)

    return new_thread
