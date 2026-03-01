from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, BackgroundTasks
from sqlalchemy.orm import Session
from database import engine, get_db
import models, schemas, services
import shutil
from typing import List
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from time import time
import os
import signal

# 1. יצירת הטבלאות
# models.Base.metadata.create_all(bind=engine) -> already created. maintance - using almebic

app = FastAPI()
# --- פתיחת השערים ל-React (CORS) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # הכתובת של ה-React שלך
    allow_credentials=True,
    allow_methods=["*"], # מאפשרים את כל הפעולות (GET, POST...)
    allow_headers=["*"],
    )

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# בתוך main.py

@app.get("/health")
def health_check():
    is_connected, message = services.check_llm_connection()
    if not is_connected:
        # מחזירים שגיאה 503 (Service Unavailable) אם החיבור נכשל
        raise HTTPException(status_code=503, detail=message)
    return {"status": "ok", "message": message}

# --- Users ---
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

# --- Documents ---
@app.post("/documents/", response_model=schemas.DocumentResponse)
def upload_document(
    user_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    # 1. שמירה בדיסק
    file_location = f"uploads/{file.filename}"
    with open(file_location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # 2. חילוץ טקסט לפי עמודים (מחזיר רשימה של מילונים)
    pages_data = services.extract_text_from_pdf(file_location)
    
    # המרת הרשימה לטקסט אחד ארוך (רק בשביל הסיכום!)
    full_text_for_summary = "\n".join([p['text'] for p in pages_data])
    
    # 3. יצירת סיכום
    root_summary = services.generate_document_summary(full_text_for_summary)
    
    # חילוץ הטקסט תוך שמירה על העיצוב (Markdown) וסינון מידע לא רלוונטי
    if isinstance(root_summary, list):
        extracted_texts = []
        for item in root_summary:
            # אנחנו מושכים אך ורק בלוקים מסוג 'text' ומתעלמים ממידע בינארי (הג'יבריש)
            if isinstance(item, dict) and item.get('type') == 'text':
                # שולפים את הטקסט המדויק עם כל הניואנסים (כוכביות, הדגשות וכו')
                extracted_texts.append(item.get('text', ''))
                
        # מחברים את כל הבלוקים עם רווח של ירידת שורה כפולה כדי לשמור על קריאות
        root_summary = "\n\n".join(extracted_texts)
        
    elif not isinstance(root_summary, str):
        root_summary = str(root_summary)
    # 4. שמירת המסמך ב-DB
    new_doc = models.Document(
        title=file.filename,
        file_path=file_location,
        user_id=user_id,
        summary=root_summary # כאן נכנס String, וזה מעולה
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)

    # 5. יצירת וקטורים ושמירת Chunks עם מספרי עמודים
    embedding_model = services.get_embedding_model()
    chunk_counter = 0
    print("🧩 Processing pages into chunks...")
    
    for page in pages_data:
        # חיתוך הטקסט של העמוד הנוכחי
        page_chunks_text = services.split_text_into_chunks(page['text'])
        
        if not page_chunks_text:
            continue
            
        # יצירת וקטורים
        vectors = embedding_model.embed_documents(page_chunks_text)
        
        # שמירה ב-DB
        for i, chunk_text in enumerate(page_chunks_text):
            vector_data = vectors[i]
            if hasattr(vector_data, "tolist"):
                vector_data = vector_data.tolist()

            new_chunk = models.Chunk(
                document_id=new_doc.id,
                text=chunk_text,
                chunk_index=chunk_counter,
                page_number=page['page_number'], # ה-GPS שלנו
                embedding=vector_data
            )
            db.add(new_chunk)
            chunk_counter += 1
    
    db.commit()
    print(f"✅ Saved {chunk_counter} chunks with page numbers!")
    
    return new_doc

# --- Threads (הבועות) ---
# בתוך main.py

@app.get("/documents/{document_id}/threads/", response_model=List[schemas.ThreadResponse])
def get_document_threads(document_id: int, db: Session = Depends(get_db)):
    threads = db.query(models.Thread).filter(models.Thread.document_id == document_id).all()
    
    # הזרקת ההיסטוריה ההיברידית לכל שיחה!
    for thread in threads:
        thread.messages = services.get_full_thread_history(thread.id, db)
        
    return threads

@app.post("/threads/", response_model=schemas.ThreadResponse)
def create_thread(thread_data: schemas.ThreadCreate, db: Session = Depends(get_db)):
    new_thread = models.Thread(
        document_id=thread_data.document_id,
        page_number=thread_data.page_number,
        selected_text=thread_data.selected_text,
        coordinates=thread_data.coordinates
    )
    db.add(new_thread)
    db.commit()
    db.refresh(new_thread)
    
    if thread_data.initial_message:
        user_msg = models.Message(
            thread_id=new_thread.id, role="user", content=thread_data.initial_message
        )
        db.add(user_msg)
        db.commit()
        
        # --- שליפת המידע המורחב ---
        doc = db.query(models.Document).filter(models.Document.id == thread_data.document_id).first()
        # שליפת כל הצ'אנקים של המסמך (בשביל החיפוש)
        all_chunks = db.query(models.Chunk).filter(models.Chunk.document_id == thread_data.document_id).all()
        
        # שליפת הטקסט המלא של העמוד הספציפי (בשביל הקשר מידי)
        # (אנחנו מניחים שיש לנו דרך להשיג את זה, הכי פשוט זה לחבר את הצ'אנקים של אותו עמוד)
        page_chunks = db.query(models.Chunk).filter(
            models.Chunk.document_id == thread_data.document_id,
            models.Chunk.page_number == thread_data.page_number
        ).all()
        current_page_text = "\n".join([c.text for c in page_chunks])

        ai_response = services.get_chat_response_for_thread(
            history=[user_msg], 
            selected_text=new_thread.selected_text,
            root_summary=doc.summary,
            doc_chunks=all_chunks,      # <--- חדש: כל המסמך לחיפוש
            current_page_text=current_page_text # <--- חדש: העמוד הנוכחי לקריאת טבלאות
        )
        
        ai_msg = models.Message(
            thread_id=new_thread.id, role="assistant", content=ai_response
        )
        db.add(ai_msg)
        db.commit()
        
    db.refresh(new_thread)
    return new_thread

@app.post("/threads/{thread_id}/messages/", response_model=schemas.MessageResponse)
def add_message_to_thread(thread_id: int, message: schemas.MessageCreate, db: Session = Depends(get_db)):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
        
    user_msg = models.Message(thread_id=thread_id, role="user", content=message.content)
    db.add(user_msg)
    db.commit()
    
    # --- שליפת המידע המורחב ---
    doc = db.query(models.Document).filter(models.Document.id == thread.document_id).first()
    
    # התיקון: במקום לשלוף רק את ההודעות הפיזיות, משתמשים בנתב שלנו
    full_history = services.get_full_thread_history(thread_id, db)
    
    all_chunks = db.query(models.Chunk).filter(models.Chunk.document_id == thread.document_id).all()
    page_chunks = db.query(models.Chunk).filter(
        models.Chunk.document_id == thread.document_id,
        models.Chunk.page_number == thread.page_number
    ).all()
    current_page_text = "\n".join([c.text for c in page_chunks])
    
    ai_response = services.get_chat_response_for_thread(
        history=full_history, # <--- מעבירים ל-LLM את כל העץ!
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

@app.post("/threads/{thread_id}/messages/", response_model=schemas.MessageResponse)
def add_message_to_thread(thread_id: int, message: schemas.MessageCreate, db: Session = Depends(get_db)):
    thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
        
    user_msg = models.Message(thread_id=thread_id, role="user", content=message.content)
    db.add(user_msg)
    db.commit()
    
    # --- שליפת המידע המורחב ---
    doc = db.query(models.Document).filter(models.Document.id == thread.document_id).first()
    history = db.query(models.Message).filter(models.Message.thread_id == thread_id).order_by(models.Message.id).all()
    
    all_chunks = db.query(models.Chunk).filter(models.Chunk.document_id == thread.document_id).all()
    
    page_chunks = db.query(models.Chunk).filter(
        models.Chunk.document_id == thread.document_id,
        models.Chunk.page_number == thread.page_number
    ).all()
    current_page_text = "\n".join([c.text for c in page_chunks])
    
    ai_response = services.get_chat_response_for_thread(
        history=history,
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
    # 1. מציאת שיחת האב
    parent_thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
    if not parent_thread:
        raise HTTPException(status_code=404, detail="Parent thread not found")

    # 2. יצירת ענף חדש - מצביע נטו (בלי לשכפל שום הודעה!)
    new_thread = models.Thread(
        document_id=parent_thread.document_id,
        page_number=parent_thread.page_number,
        selected_text=parent_thread.selected_text,
        coordinates=parent_thread.coordinates,
        parent_thread_id=parent_thread.id,  # המצביע לאבא
        forked_from_message_id=message_id   # המצביע לנקודת הפיצול
    )
    db.add(new_thread)
    db.commit()
    db.refresh(new_thread)

    new_thread.messages = services.get_full_thread_history(new_thread.id, db)

    return new_thread

def kill_server_logic():
    """השרת מכבה את עצמו בלבד"""
    print("💀 Shutting down Backend process...")
    time.sleep(1) 
    
    # הורג את התהליך הנוכחי בלבד (PID = Process ID)
    os.kill(os.getpid(), signal.SIGTERM)

@app.post("/system/shutdown")
def shutdown_system(background_tasks: BackgroundTasks):
    # מפעיל את ההריגה ברקע כדי שנוכל להחזיר תשובה ללקוח קודם
    background_tasks.add_task(kill_server_logic)
    return {"message": "System is shutting down..."}