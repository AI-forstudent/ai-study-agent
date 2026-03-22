// src/services/api.ts
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// 1. יצירת מופע מותאם של Axios כדי שלא נזהם את ההגדרות הגלובליות
const apiClient = axios.create({
  baseURL: API_URL,
});

// 2. Interceptor - "מיירט הבקשות" שמוסיף את הטוקן אוטומטית לפני כל פנייה לשרת
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    // הוספת הטוקן להדר (Header) בדיוק כמו שה-Backend מצפה לקבל
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

export const api = {
  // ==========================================
  // Auth & Users
  // ==========================================
  // FastAPI מצפה לקבל את פרטי ההתחברות כ-FormData (username, password)
  login: (formData: FormData) => apiClient.post('/login/', formData),
  register: (userData: any) => apiClient.post('/users/', userData),

  // ==========================================
  // System
  // ==========================================
  checkHealth: () => apiClient.get('/health'),

  // ==========================================
  // Documents
  // ==========================================
  // התיקון: אין יותר צורך לשלוח userId! השרת יודע מי אנחנו לפי הטוקן
  getUserDocuments: () => apiClient.get('/documents/'),
  
  uploadDocument: (file: File, generateSummary: boolean = false) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('generate_summary', generateSummary.toString()); 
    
    return apiClient.post('/documents/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  estimatePageSummaryTokens: (documentId: number, pageNumber: number) => 
    apiClient.get(`/documents/${documentId}/pages/${pageNumber}/estimate-summary`),
    
  createPageSummary: (documentId: number, pageNumber: number) => 
    apiClient.post(`/documents/${documentId}/pages/${pageNumber}/summary`),
  
  getDocumentSummaries: (documentId: number) => 
    apiClient.get(`/documents/${documentId}/summaries`),

  // ==========================================
  // Threads & Messages
  // ==========================================
  getThreads: (docId: number) => apiClient.get(`/documents/${docId}/threads/`),
  
  getThread: (threadId: number) => apiClient.get(`/threads/${threadId}`),
  
  createThread: (payload: any) => apiClient.post('/threads/', payload),
  
  sendMessage: (threadId: number, content: string) => 
    apiClient.post(`/threads/${threadId}/messages/`, { content }),
    
  forkThread: (threadId: number, messageId: number) => 
    apiClient.post(`/threads/${threadId}/fork/?message_id=${messageId}`),
};

export default API_URL;