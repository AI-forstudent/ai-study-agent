import os
from dotenv import load_dotenv
import pdfplumber
from langchain_text_splitters import RecursiveCharacterTextSplitter
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

# --- Imports for Providers ---
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_huggingface import HuggingFaceEmbeddings

load_dotenv()

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
        return content if isinstance(content, str) else str(content)
        
    except Exception as e:
        print(f"❌ Error chat: {e}")
        return "מצטער, הייתה שגיאה ביצירת התשובה."