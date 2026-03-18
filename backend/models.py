from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB
from database import Base
from pgvector.sqlalchemy import Vector

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    documents = relationship("Document", back_populates="owner")

class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String)
    file_path = Column(String)
    summary = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    owner = relationship("User", back_populates="documents")
    threads = relationship("Thread", back_populates="document")
    chunks = relationship("Chunk", back_populates="document")

class Thread(Base):
    __tablename__ = "threads"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    parent_thread_id = Column(Integer, ForeignKey("threads.id"), nullable=True)
    forked_from_message_id = Column(Integer, ForeignKey("messages.id", use_alter=True), nullable=True)
    page_number = Column(Integer)
    coordinates = Column(JSONB) 
    selected_text = Column(Text, nullable=True)
    emoji = Column(String, nullable=True, default="💬")
    title = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    document = relationship("Document", back_populates="threads")
    messages = relationship("Message", back_populates="thread", foreign_keys="[Message.thread_id]")

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("threads.id"))
    role = Column(String) # user/assistant
    content = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    thread = relationship("Thread", back_populates="messages", foreign_keys="[Message.thread_id]")

class Chunk(Base):
    __tablename__ = "chunks"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    text = Column(Text)
    chunk_index = Column(Integer)
    
    page_number = Column(Integer) 
    
    embedding = Column(Vector(768)) 
    document = relationship("Document", back_populates="chunks")