import os
from dotenv import load_dotenv
import pdfplumber
import models
from langchain_text_splitters import RecursiveCharacterTextSplitter
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy import select, literal, or_ , cast, null, Integer
from sqlalchemy.orm import Session, aliased
from typing import List, Optional
# --- Imports for Providers ---
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_huggingface import HuggingFaceEmbeddings

load_dotenv()
# שורת דיבאג זמנית - מדפיסה רק את ההתחלה של המפתח כדי לראות מה באמת נטען
api_key = os.getenv("GOOGLE_API_KEY")
print(f"🔍 DEBUG: API Key loaded starts with: {api_key[:10] if api_key else 'None'}")

def check_llm_connection():
    """מבצע בדיקה יזומה מול הספק הנבחר כדי לראות שהכל תקין"""
    try:
        print(f"🩺 Testing connection to the model...")
        # ניסיון לבצע פעולה זולה ומהירה (Embedding למילה אחת)
        embed_model = get_embedding_model()
        embed_model.embed_query("test")
        print("✅ Connection Healthy!")
        return True, f"Connected to the model"
    except Exception as e:
        error_msg = f"Connection Failed: {str(e)}"
        print(f"❌ {error_msg}")
        return False, error_msg


# --- 1. Factory Functions (המוח שמחליט באיזה מודל להשתמש) ---

def get_smart_model():
    """מחזיר את המודל החכם (לסיכומים וניתוח מעמיק)"""
    return ChatGoogleGenerativeAI(
        model="gemini-flash-latest",
        temperature=0.3, # need to be implemented to the user interaface  
        google_api_key=os.getenv("GOOGLE_API_KEY")
    )

def get_fast_model():
    return ChatGoogleGenerativeAI(
        model="gemini-flash-latest",
        temperature=0.5, # need to be implemented to the user interaface  
        google_api_key=os.getenv("GOOGLE_API_KEY")
    )

def get_embedding_model():


    # פתרון הנדסי: במקום להילחם ב-API של גוגל שמחזיר 404, נעבור למודל מקומי.
    # המודל הזה (mpnet) מייצר וקטורים בגודל 768, כך שהוא מתאים בדיוק ל-DB שלנו!
    print("🚀 Bypassing Google API: Using local HuggingFace model (768 dimensions)...")
    return HuggingFaceEmbeddings(model_name="all-mpnet-base-v2")

def extract_text_from_pdf(file_path: str):
    print(f"🔍 Starting extraction for: {file_path}")
    pages_content = []
    try:
        with pdfplumber.open(file_path) as pdf:
        # need to be implemented - saving a summery of every page (maybe using the total summery) and to add a feature to the user interface
        # when click a side botton - presenting the summery of every page a side the the original pdf page 
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                if text:
                    pages_content.append({"page_number": i + 1, "text": text})
        print(f"✅ Extraction complete! Processed {len(pages_content)} pages.")
        return pages_content
    except Exception as e:
        print(f"❌ Error reading PDF: {e}")
        return []

def split_text_into_chunks(text: str, chunk_size: int = 1000, chunk_overlap: int = 200):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=["\n\n", "\n", " ", ""]
    )
    return text_splitter.split_text(text)

def generate_document_summary(text: str) -> str:
    print(f"🤖 Generating summary...")
    try:
        llm = get_smart_model()
        limit = 40000
        safe_text = text[:limit]
        
        # need to be implemented to the user settenigs interaface with this as the default option
        prompt = f"""
        You are an expert study assistant. 
        Generate a comprehensive summary of the following document text.
        Document Text: 
        {safe_text}     
        Summary:
        """
        response = llm.invoke(prompt)
        content = response.content
        return content if isinstance(content, str) else str(content)
    except Exception as e:
        print(f"❌ Error summary: {e}")
        return "Error generating summary."

def find_relevant_chunks(query: str, chunks_data: list, top_k: int = 3):
    # in order to make the search more efficient - needs to imlement the location of the chanks in the page and using it.
    try:
        if not chunks_data:
            return []
            
        embed_model = get_embedding_model()
        
        # חישוב הוקטור לשאלה (מתבצע או בגוגל או מקומית לפי הבחירה)
        query_vector = embed_model.embed_query(query)
        
        # המרה ל-NumPy
        chunk_vectors = [np.array(chunk.embedding) for chunk in chunks_data]
        
        if not chunk_vectors:
            return []

        # חישוב דמיון קוסינוס
        similarities = cosine_similarity([query_vector], chunk_vectors)[0]
        top_indices = similarities.argsort()[-top_k:][::-1]
        
        relevant_texts = []
        for idx in top_indices:
            relevant_texts.append(f"[From Page {chunks_data[idx].page_number}]: {chunks_data[idx].text}")
            
        return relevant_texts
    except Exception as e:
        print(f"⚠️ Vector search warning: {e}")
        return []

def get_chat_response_for_thread(history: list, selected_text: str, root_summary: str, doc_chunks: list, current_page_text: str = ""):
    print(f"💬 Generating chat response...")
    llm = get_fast_model() # we want to implementv a user intreface option to chose the mode.(default fast)
    
    last_user_msg = history[-1].content if history else ""
    
    # 1. חיפוש חכם (RAG)
    search_query = f"{selected_text} {last_user_msg}"
    relevant_context = find_relevant_chunks(search_query, doc_chunks)
    relevant_context_str = "\n---\n".join(relevant_context)

    # 2. הכנת היסטוריה
    conversation_text = ""
    for msg in history:
        conversation_text += f"{msg.role}: {msg.content}\n"
    
    # in the idial plan we want to save the prompts and the answer in the data base represented by b-tree in order to manage the context.
    # morover - we will implement the option to merge and "divide/duplicate" the chats - similar to github.
    # 3. פרומפט (זהה לשני המודלים)
    prompt = f"""
    You are a helpful and precise private tutor.
    
    --- DATA SOURCE 1: IMMEDIATE CONTEXT (Full page) ---
    {current_page_text}
    
    --- DATA SOURCE 2: RELEVANT KNOWLEDGE (From search) ---
    {relevant_context_str}
    
    --- DATA SOURCE 3: GLOBAL SUMMARY ---
    {root_summary}
    
    --- USER REQUEST ---
    HIGHLIGHTED TEXT: "{selected_text}"
    CHAT HISTORY:
    {conversation_text}
    
    INSTRUCTIONS:
    1. Answer in HEBREW (עברית).
    2. Use "DATA SOURCE 1" to understand tables and context precisely.
    3. Keep answer SHORT (Max 7 lines). 
    4. Use **bold** and bullet points (*).
    
    Your Answer:
    """
    # like the default prompt instructurs above we will give the user the abbiltiy to dtermaine his own settings, for each chat/file/query 
    # not have to be the same dynamic settings
    try:
        response = llm.invoke(prompt)
        content = response.content
        
        # טיפול בחילוץ טקסט נקי במידה והמודל מחזיר רשימה של בלוקים (כמו שקרה בתמונה)
        if isinstance(content, list):
            extracted_texts = []
            for item in content:
                if isinstance(item, dict) and 'text' in item:
                    extracted_texts.append(item['text'])
                elif isinstance(item, str):
                    extracted_texts.append(item)
            return "\n\n".join(extracted_texts)
            
        return content if isinstance(content, str) else str(content)
        
    except Exception as e:
        print(f"❌ Error chat: {e}")
        return "מצטער, הייתה שגיאה ביצירת התשובה."

def get_thread_history_python(thread_id: int, db: Session, max_depth: int) -> Optional[List[models.Message]]:
    """
    סורק את היסטוריית השיחה באמצעות Python.
    מחזיר את רשימת ההודעות, או None אם העץ עמוק מדי (ואז נעבור ל-SQL).
    """
    history = []
    current_thread_id = thread_id
    limit_message_id = None  # בשיחה הנוכחית (הילד) אין הגבלה, אנחנו רוצים את כל ההודעות
    depth = 0
    
    while current_thread_id:
        # 1. בדיקת סף העומק
        if depth > max_depth:
            print(f"🌲 Tree is too deep (depth > {max_depth}). Switching to SQL!")
            return None # מחזירים None כדי לאותת לנתב ההיברידי לעבור ל-SQL
            
        # 2. שליפת השרשור הנוכחי
        current_thread = db.query(models.Thread).filter(models.Thread.id == current_thread_id).first()
        if not current_thread:
            break
            
        # 3. בניית השאילתה להודעות של השרשור הזה
        query = db.query(models.Message).filter(models.Message.thread_id == current_thread_id)
        
        # אם אנחנו באבא, אנחנו מגבילים את השליפה עד לנקודת הפיצול
        if limit_message_id is not None:
            query = query.filter(models.Message.id <= limit_message_id)
            
        # שולפים את ההודעות בסדר עולה (מהישן לחדש)
        messages = query.order_by(models.Message.id.asc()).all()
        
        # 4. מחברים את ההודעות לתחילת ההיסטוריה (כי אנחנו הולכים אחורה)
        history = messages + history
        
        # 5. מכינים את הקפיצה לאבא הבא
        limit_message_id = current_thread.forked_from_message_id
        current_thread_id = current_thread.parent_thread_id
        depth += 1
        
    return history

def get_full_thread_history(thread_id: int, db: Session, max_depth: int = 3) -> List[models.Message]:
    """
    הנתב ההיברידי: מנסה קודם עם פייתון, ואם העץ עמוק מדי, עובר ל-SQL.
    """
    # שלב 3 - מנסים את מנגנון הפייתון
    history = get_thread_history_python(thread_id, db, max_depth)
    
    # שלב 4 - הפולבאק ל-SQL (נממש בשלב הבא!)
    if history is None:
        print("🚀 Executing Recursive SQL CTE for deep thread history...")
        # התיקון כאן: מוודאים שאנחנו באמת קוראים לפונקציית ה-SQL ושומרים את התוצאה
        history = get_thread_history_sql(thread_id, db)
        
    return history        

def get_thread_history_sql(thread_id: int, db: Session) -> List[models.Message]:
    """
    סורק את היסטוריית השיחה באמצעות CTE רקורסיבי בגישת SQLAlchemy 2.0 טהורה.
    """
    
    # 1. Base Case
    base_query = (
        select(
            models.Thread.id.label("current_thread_id"),
            models.Thread.parent_thread_id,
            models.Thread.forked_from_message_id,
            # התיקון: כפיית טיפוס Integer על ה-Null ברמת ה-DB!
            cast(null(), Integer).label("limit_msg_id") 
        )
        .where(models.Thread.id == thread_id)
        .cte(name="thread_path", recursive=True)
    )

    # 2. Recursive Step
    t_alias = aliased(models.Thread)
    
    recursive_query = (
        select(
            t_alias.id,
            t_alias.parent_thread_id,
            t_alias.forked_from_message_id,
            base_query.c.forked_from_message_id 
        )
        .join(base_query, t_alias.id == base_query.c.parent_thread_id)
    )

    # 3. חיבור (UNION ALL)
    recursive_cte = base_query.union_all(recursive_query)

    # 4. Final Query
    stmt = (
        select(models.Message)
        .join(recursive_cte, models.Message.thread_id == recursive_cte.c.current_thread_id)
        .where(
            or_(
                recursive_cte.c.limit_msg_id.is_(None), 
                models.Message.id <= recursive_cte.c.limit_msg_id 
            )
        )
        .order_by(models.Message.id.asc())
    )

    messages = db.execute(stmt).scalars().all()
    
    return list(messages)