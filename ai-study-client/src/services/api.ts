// src/services/api.ts
import axios from 'axios';

// Single base URL — all traffic now goes to the unified API on port 8001.
// In production this resolves to the domain root (nginx routes /api/v1/* and
// /uploads/* to the backend container; no path prefix needed here).
const API_BASE = import.meta.env.VITE_AI_API_URL || 'http://localhost:8001';

const apiClient = axios.create({
  baseURL: API_BASE,
});

// Inject Bearer token on every outgoing request
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error),
);

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────
  // FastAPI OAuth2 expects FormData (username + password fields)
  login:      (formData: FormData) => apiClient.post('/api/v1/auth/login', formData),
  register:   (userData: unknown)  => apiClient.post('/api/v1/auth/register', userData),
  guestLogin: ()                   => apiClient.post('/api/v1/auth/guest-login'),

  // ── System ───────────────────────────────────────────────────────────────
  checkHealth: () => apiClient.get('/health'),

  // ── Documents ────────────────────────────────────────────────────────────
  getUserDocuments: () => apiClient.get('/api/v1/documents/'),

  uploadDocument: (file: File, generateSummary = false) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('generate_summary', generateSummary.toString());
    return apiClient.post('/api/v1/documents/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  createPageSummary: (documentId: number, pageNumber: number) =>
    apiClient.post(`/api/v1/documents/${documentId}/pages/${pageNumber}/summary`),

  getDocumentSummaries: (documentId: number) =>
    apiClient.get(`/api/v1/documents/${documentId}/summaries`),

  deleteDocument: (documentId: number) =>
    apiClient.delete(`/api/v1/documents/${documentId}`),

  generateCodeReview: (documentId: number) =>
    apiClient.post(`/api/v1/documents/${documentId}/review`),

  // filePath is stored as "uploads/filename.pdf" — served directly by backend
  getFile: (filePath: string) =>
    apiClient.get(`/${filePath}`, { responseType: 'blob' }),

  toggleVisibility: (documentId: number, isPublic: boolean) =>
    apiClient.patch(`/api/v1/documents/${documentId}/visibility`, { is_public: isPublic }),

  getPublicDocuments: () => apiClient.get('/api/v1/documents/public'),

  // ── Folders ──────────────────────────────────────────────────────────────
  getFolders: () => apiClient.get('/api/v1/folders/'),

  createFolder: (payload: { name: string; color?: string | null; persona_id?: string | null }) =>
    apiClient.post('/api/v1/folders/', payload),

  updateFolder: (id: number, payload: { name?: string; color?: string | null; is_starred?: boolean; persona_id?: string | null }) =>
    apiClient.put(`/api/v1/folders/${id}`, payload),

  deleteFolder: (id: number) =>
    apiClient.delete(`/api/v1/folders/${id}`),

  moveDocument: (docId: number, folderId: number | null) =>
    apiClient.patch(`/api/v1/documents/${docId}/folder`, { folder_id: folderId }),

  starDocument: (docId: number, isStarred: boolean) =>
    apiClient.patch(`/api/v1/documents/${docId}/star`, { is_starred: isStarred }),

  // ── Personas ─────────────────────────────────────────────────────────────
  // Note: useAppStore.ts calls Grand Vision persona routes directly via fetch.
  // These wrappers remain for any component that imports api directly.
  getPersonas: () => apiClient.get('/api/v1/personas/'),

  createPersona: (payload: {
    id: string;
    display_name: string;
    traits?: Record<string, string>;
    manual_prompt_override?: string;
  }) => apiClient.post('/api/v1/personas/', payload),

  // ── Threads & Messages ────────────────────────────────────────────────────
  getThreads: (docId: number) =>
    apiClient.get(`/api/v1/threads/document/${docId}`),

  getThread: (threadId: number) =>
    apiClient.get(`/api/v1/threads/${threadId}`),

  createThread: (payload: unknown) =>
    apiClient.post('/api/v1/threads/', payload),

  sendMessage: (threadId: number, content: string) =>
    apiClient.post(`/api/v1/threads/${threadId}/messages`, { content }),

  forkThread: (threadId: number, messageId: number) =>
    apiClient.post(`/api/v1/threads/${threadId}/fork?message_id=${messageId}`),

  // ── Personal Hub ──────────────────────────────────────────────────────────
  getProfile: () =>
    apiClient.get('/api/v1/profile/'),

  updateProfile: (payload: Record<string, unknown>) =>
    apiClient.put('/api/v1/profile/', payload),

  getCourseRecords: () =>
    apiClient.get('/api/v1/profile/courses'),

  addCourseRecord: (payload: { course_id: number; status?: string; grade?: number | null }) =>
    apiClient.post('/api/v1/profile/courses', payload),

  updateCourseRecord: (recordId: number, payload: Record<string, unknown>) =>
    apiClient.put(`/api/v1/profile/courses/${recordId}`, payload),

  getJobApplications: () =>
    apiClient.get('/api/v1/profile/jobs'),

  addJobApplication: (payload: { company: string; role: string; status?: string }) =>
    apiClient.post('/api/v1/profile/jobs', payload),

  updateJobApplication: (jobId: number, payload: Record<string, unknown>) =>
    apiClient.put(`/api/v1/profile/jobs/${jobId}`, payload),

  uploadTranscript: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/api/v1/profile/transcript', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // Deletes every StudentCourseRecord for the authenticated user (clean re-import).
  resetCourseRecords: () =>
    apiClient.delete('/api/v1/profile/courses'),

  // Deletes a single course record by ID.
  deleteCourseRecord: (recordId: number) =>
    apiClient.delete(`/api/v1/profile/courses/${recordId}`),

  // Get-or-create a global catalog entry by name (used by Add Course modal).
  createCatalogEntry: (payload: { name: string; credits?: number | null; department?: string | null }) =>
    apiClient.post('/api/v1/profile/catalog', payload),

  // Patch a catalog entry's name or credits (used by Edit Course modal).
  updateCatalogEntry: (courseId: number, payload: { name?: string; credits?: number | null }) =>
    apiClient.put(`/api/v1/profile/catalog/${courseId}`, payload),
};

export default API_BASE;
