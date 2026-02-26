// src/services/api.ts
import axios from 'axios';

const API_URL = "http://localhost:8000";

export const api = {
  checkHealth: () => axios.get(`${API_URL}/health`),
  
  uploadDocument: (file: File, userId: number) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API_URL}/documents/?user_id=${userId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  
  getThreads: (docId: number) => axios.get(`${API_URL}/documents/${docId}/threads/`),
  
  createThread: (payload: any) => axios.post(`${API_URL}/threads/`, payload),
  
  sendMessage: (threadId: number, content: string) => 
    axios.post(`${API_URL}/threads/${threadId}/messages/`, { content }),
    
  shutdown: () => axios.post(`${API_URL}/system/shutdown`)
};

export default API_URL;