from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import select, literal, or_ , cast, null, Integer
from sqlalchemy.orm import Session, aliased
from typing import List, Optional
# --- Imports for Providers ---
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
import os
import pdfplumber
import models
import json

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
        google_api_key=os.getenv("GOOGLE_API_KEY"),
        timeout=15,       # מקסימום 15 שניות המתנה
        max_retries=1     # ניסיון אחד בלבד. נכשל? זורק שגיאה.
    )

def get_fast_model():
    return ChatGoogleGenerativeAI(
        model="gemini-flash-latest",
        temperature=0.5, # need to be implemented to the user interaface  
        google_api_key=os.getenv("GOOGLE_API_KEY"),
        timeout=15,
        max_retries=1
    )

def ask_gemini(prompt: str, use_smart_model: bool = False) -> str:
    """
    צינור התקשורת מול ג'ימיני - ללא פולבאק מקומי!
    אם ג'ימיני נופל, מחזירים הודעת שגיאה מסודרת למשתמש שמוצגת בצ'אט.
    """
    try:
        llm = get_smart_model() if use_smart_model else get_fast_model()
        response = llm.invoke(prompt)
        content = response.content
        
        if isinstance(content, list):
            extracted_texts = [item['text'] for item in content if isinstance(item, dict) and 'text' in item]
            return "\n\n".join(extracted_texts)
            
        return content if isinstance(content, str) else str(content)
        
    except Exception as e:
        print(f"❌ [Gemini API Error]: {e}")
        return "מצטער, שירות הענן (Gemini) עמוס או לא זמין כרגע. אנא נסה לשלוח את ההודעה שוב בעוד מספר רגעים. 🔄"

def generate_thread_metadata_background(thread_id: int, prompt_text: str, selected_text: str, db: Session):
    """
    משימת רקע ליצירת כותרת ואימוג'י לשיחה באמצעות הענן (Gemini JSON Mode).
    """
    print("☁️ [Metadata] Using CLOUD model (Gemini) for Title & Emoji (JSON Mode)...")
    
    new_title = None
    new_emoji = None

    # אופטימיזציית טוקנים: פרומפט קצר, הוראות נוקשות לפורמט פלט
    cloud_prompt = f"""
    Analyze the following text from a document and the user's question about it.
    Selected Text: "{selected_text}"
    User Question: "{prompt_text}"

    Task:
    1. Create a short title in HEBREW (2-5 words) summarizing the conversation.
    2. Choose ONE relevant emoji that represents the topic.

    Respond ONLY with a valid JSON in this exact format, no markdown, no other text:
    {{"title": "your hebrew title", "emoji": "your emoji"}}
    """
    
    try:
        # משתמשים במודל המהיר והזול (Flash)
        response_text = ask_gemini(cloud_prompt, use_smart_model=False)
        
        # ניקוי למקרה שג'ימיני החליט לעטוף את התשובה ב-Markdown של קוד
        clean_json_string = response_text.replace("```json", "").replace("```", "").strip()
        parsed_data = json.loads(clean_json_string)
        
        new_title = parsed_data.get("title")
        new_emoji = parsed_data.get("emoji")
        print(f"✨ Cloud Metadata generated: {new_title} {new_emoji}")
        
    except Exception as e:
        print(f"❌ [Metadata] Cloud JSON parsing failed: {e}")
        pass # במקרה של שגיאה, אין צורך להקריס כלום, פשוט נשאר עם הדיפולט

    # שלב העדכון בדאטאבייס בפעולה אחת!
    if new_title or new_emoji:
        thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
        if thread:
            if new_title and new_title != "שיחה חדשה":
                thread.title = new_title
            if new_emoji:
                thread.emoji = new_emoji
            db.commit()
            
def get_embedding_model():
    print("☁️ Using Google API (gemini-embedding-001 at 768 dimensions)...")
    return GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-001", # המודל החדש והתקין מהצילום מסך שלך!
        google_api_key=os.getenv("GOOGLE_API_KEY"),
        task_type="retrieval_document",
        # פרמטר הקסם שחותך את ה-3072 ל-768 כדי שהדאטאבייס לא יקרוס:
        output_dimensionality=768
    )

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
    print(f"🤖 Generating summary directly with Cloud Model...")
    limit = 40000
    safe_text = text[:limit]
    
    prompt = f"""
    You are an expert study assistant. 
    Generate a comprehensive summary of the following document text.
    Document Text: 
    {safe_text}     
    Summary:
    """
    
    try:
        # קריאה ישירה למודל החכם, ללא הנתב (Orchestrator)
        llm = get_smart_model()
        response = llm.invoke(prompt)
        
        content = response.content
        
        # טיפול במבנה הנתונים שג'ימיני עלול להחזיר
        if isinstance(content, list):
            extracted_texts = [item['text'] for item in content if isinstance(item, dict) and 'text' in item]
            return "\n\n".join(extracted_texts)
            
        return content if isinstance(content, str) else str(content)
        
    except Exception as e:
        # כאן אנחנו תופסים קריסה של ה-API (למשל אם חרגת ממכסת הבקשות)
        print(f"❌ [Document Summary] Cloud API Failed: {e}")
        return "מצטער, שירות הענן (Gemini) עמוס או לא זמין כרגע, ולכן לא ניתן היה לייצר סיכום מלא למסמך. אפשר לנסות להעלות את המסמך שוב מאוחר יותר! 📄"

def find_relevant_chunks(query: str, document_id: int, db: Session, top_k: int = 3):
    try:
        embed_model = get_embedding_model()
        
        # ממירים את שאלת המשתמש לוקטור
        query_vector = embed_model.embed_query(query)
        
        # קסם ה-pgvector: מחשבים מרחק ישירות ב-SQL ומביאים רק את ה-3 הכי קרובים
        results = db.query(models.Chunk).filter(
            models.Chunk.document_id == document_id
        ).order_by(
            models.Chunk.embedding.cosine_distance(query_vector)
        ).limit(top_k).all()
        
        relevant_texts = []
        for chunk in results:
            relevant_texts.append(f"[From Page {chunk.page_number}]: {chunk.text}")
            
        return relevant_texts
    except Exception as e:
        print(f"⚠️ Vector search warning: {e}")
        return []
    
def get_chat_response_for_thread(
    history: list, 
    selected_text: str, 
    root_summary: str, 
    document_id: int, 
    db: Session, 
    current_page_text: str = "",
    thread_persona_id: str = None,  # <-- חדש
    doc_persona_id: str = None      # <-- חדש
):
    print(f"💬 Generating chat response (Gemini Only)...")
    
    last_user_msg = history[-1].content if history else ""
    
    # חיפוש חכם (RAG) ישירות מהדאטאבייס
    search_query = f"{selected_text} {last_user_msg}"
    relevant_context = find_relevant_chunks(search_query, document_id, db)
    relevant_context_str = "\n---\n".join(relevant_context)

    # הכנת היסטוריה מלאה לג'ימיני
    full_conversation = ""
    for msg in history:
        full_conversation += f"{msg.role}: {msg.content}\n"
        
    # --- הזרקת אישיות (Persona Injection) ---
    # מתחילים עם הדיפולט שלנו:
    system_prompt = "You are a helpful and precise private tutor."
    
    # מחליטים באיזה ID להשתמש (השיחה דורסת את המסמך)
    active_persona_id = thread_persona_id or doc_persona_id
    
    if active_persona_id:
        print(f"🎭 Injecting Persona ID: {active_persona_id}")
        persona = db.query(models.Persona).filter(models.Persona.id == active_persona_id).first()
        if persona and persona.system_prompt:
            system_prompt = persona.system_prompt
    else:
        print("🎭 Using Default Persona (No specific ID found).")
    # ---------------------------------------

    # הפרומפט הראשי והיחיד לג'ימיני
    cloud_prompt = f"""
    {system_prompt}
    
    --- DATA SOURCE 1: IMMEDIATE CONTEXT (Full page) ---
    {current_page_text}
    
    --- DATA SOURCE 2: RELEVANT KNOWLEDGE ---
    {relevant_context_str}
    
    --- DATA SOURCE 3: GLOBAL SUMMARY ---
    {root_summary}
    
    --- USER REQUEST ---
    HIGHLIGHTED TEXT: "{selected_text}"
    CHAT HISTORY:
    {full_conversation}
    
    INSTRUCTIONS: Answer in HEBREW. Use DATA SOURCE 1 for context. Keep answer SHORT (Max 7 lines).
    Your Answer:
    """
    
    # קריאה ישירה לצינור של ג'ימיני
    return ask_gemini(prompt=cloud_prompt, use_smart_model=False)

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

def count_tokens_in_text(text: str) -> int:
    """
    מקבל טקסט ומחשב כמה טוקנים הוא שוקל באמצעות המודל.
    """
    try:
        llm = get_smart_model()
        # הפונקציה המובנית של LangChain לספירת טוקנים במודל הנבחר
        return llm.get_num_tokens(text)
    except Exception as e:
        print(f"⚠️ Token counting failed, using fallback calculation: {e}")
        # הערכה גסה למקרה שה-API לא זמין רגעית (כ-4 תווים לטוקן)
        return len(text) // 4 

def generate_specific_page_summary(page_text: str) -> str:

    """
    פונקציה ייעודית לסיכום עמוד בודד בלבד.
    """
    prompt = f"""
    You are an expert study assistant. 
    Generate a concise, well-structured, and highly informative summary of the following document page.
    Highlight key concepts, main arguments, and important terms.
    
    CRITICAL: Your response MUST be in HEBREW.
    
    Page Text:
    {page_text}
    
    Summary:
    """
    # קוראים לג'ימיני עם המודל החכם
    return ask_gemini(prompt, use_smart_model=True)


