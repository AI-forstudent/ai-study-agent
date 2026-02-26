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

class ThreadCreate(ThreadBase):
    document_id: int
    # אופציונלי: הודעה ראשונה יחד עם יצירת השרשור
    initial_message: Optional[str] = None 

class ThreadResponse(ThreadBase):
    id: int
    document_id: int
    created_at: datetime
    messages: List[MessageResponse] = [] # מחזיר את כל ההודעות בבועה
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
    class Config:
        from_attributes = True