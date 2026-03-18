// src/services/api.ts
import axios from 'axios';

const API_URL = "http://localhost:8000";

export const api = {
  checkHealth: () => axios.get(`${API_URL}/health`),

  estimatePageSummaryTokens: (documentId: number, pageNumber: number) => 
    axios.get(`${API_URL}/documents/${documentId}/pages/${pageNumber}/estimate-summary`),
    
  createPageSummary: (documentId: number, pageNumber: number) => 
    axios.post(`${API_URL}/documents/${documentId}/pages/${pageNumber}/summary`),
  
uploadDocument: (file: File, userId: number, generateSummary: boolean = false) => {
    const formData = new FormData();
    formData.append('file', file);
    // שים לב: FormData תמיד שולח טקסט, אז אנחנו ממירים את ה-boolean למחרוזת
    formData.append('generate_summary', generateSummary.toString()); 
    
    return axios.post(`${API_URL}/documents/?user_id=${userId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getThreads: (docId: number) => axios.get(`${API_URL}/documents/${docId}/threads/`),

  getThread: (threadId: number) => axios.get(`${API_URL}/threads/${threadId}`),

  getUserDocuments: (userId: number) => axios.get(`${API_URL}/documents/user/${userId}`),
  
  createThread: (payload: any) => axios.post(`${API_URL}/threads/`, payload),
  
  sendMessage: (threadId: number, content: string) => 
    axios.post(`${API_URL}/threads/${threadId}/messages/`, { content }),
    
  shutdown: () => axios.post(`${API_URL}/system/shutdown`),

// הוסף את זה מתחת לפונקציות האחרות של השיחות:
  forkThread: (threadId: number, messageId: number) => 
    axios.post(`${API_URL}/threads/${threadId}/fork/?message_id=${messageId}`),
};

export default API_URL;