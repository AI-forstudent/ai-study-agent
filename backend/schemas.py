from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional, Any

# --- User Schemas ---
class UserBase(BaseModel):
    email: str

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    is_active: bool = True
    class Config:
        from_attributes = True

# --- Message Schemas ---
class MessageBase(BaseModel):
    content: str
    role: str = "user" # user / assistant

class MessageCreate(MessageBase):
    pass

class MessageResponse(MessageBase):
    id: int
    created_at: datetime
    class Config:
        from_attributes = True

# --- Thread Schemas ---
class ThreadBase(BaseModel):
    page_number: int
    selected_text: Optional[str] = None
    coordinates: Optional[Any] = None # JSON של מיקום הסימון
    emoji: Optional[str] = "💬"
    title: Optional[str] = None

class ThreadCreate(ThreadBase):
    document_id: int
    # אופציונלי: הודעה ראשונה יחד עם יצירת השרשור
    initial_message: Optional[str] = None 
    persona_id: Optional[str] = None # <-- התוספת שלנו

class ThreadResponse(ThreadBase):
    id: int
    document_id: int
    created_at: datetime
    parent_thread_id: Optional[int] = None
    forked_from_message_id: Optional[int] = None
    persona_id: Optional[str] = None # התוספת שלנו
    messages: List[MessageResponse] = [] 
    class Config:
        from_attributes = True

# --- Document Schemas ---
class DocumentBase(BaseModel):
    title: str

class DocumentCreate(DocumentBase):
    pass 

class DocumentResponse(DocumentBase):
    id: int
    user_id: int
    file_path: str
    created_at: datetime
    default_persona_id: Optional[str] = None # התוספת שלנו
    class Config:
        from_attributes = True

# --- Page Summary Schemas ---
class PageSummaryBase(BaseModel):
    page_number: int
    summary: str

class PageSummaryCreate(PageSummaryBase):
    document_id: int

class PageSummaryResponse(PageSummaryBase):
    id: int
    document_id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

class PersonaBase(BaseModel):
    id: str
    display_name: str
    system_prompt: str

class PersonaResponse(PersonaBase):
    created_at: datetime
    class Config:
        from_attributes = True