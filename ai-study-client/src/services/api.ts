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
  // Exchanges a Google ID token (from Google Identity Services) for our JWT.
  googleLogin: (idToken: string) =>
    apiClient.post('/api/v1/auth/google', { id_token: idToken }),

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

  createFullDocumentSummary: (documentId: number) =>
    apiClient.post(`/api/v1/documents/${documentId}/summary/all`),

  createCustomSummary: (documentId: number, customPrompt: string, pageNumber?: number) =>
    apiClient.post(`/api/v1/documents/${documentId}/summary/custom`, {
      custom_prompt: customPrompt,
      page_number: pageNumber ?? null,
    }),

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
  // All persona traffic flows through here so the auth interceptor attaches
  // the Bearer token automatically. Direct fetch() calls would be unauth'd
  // and get 401 from the backend's per-user filtering.
  getPersonas: () => apiClient.get('/api/v1/personas/'),

  createPersona: (payload: {
    id: string;
    display_name: string;
    description?: string;
    persona_type?: string;
    system_prompt?: string;
    tags?: string[];
    icon?: string;
    original_persona_id?: string | null;
  }) => apiClient.post('/api/v1/personas/', payload),

  updatePersona: (id: string, payload: {
    display_name?: string;
    description?: string;
    system_prompt?: string;
    tags?: string[];
    icon?: string;
  }) => apiClient.put(`/api/v1/personas/${encodeURIComponent(id)}`, payload),

  deletePersona: (id: string) =>
    apiClient.delete(`/api/v1/personas/${encodeURIComponent(id)}`),

  clonePersona: (id: string) =>
    apiClient.post(`/api/v1/personas/${encodeURIComponent(id)}/clone`),

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

  // ── Courses ───────────────────────────────────────────────────────────────
  // Returns the caller's courses (owned + admin-assigned + starred).
  listCourses: () => apiClient.get('/api/v1/courses/'),

  // Public catalog for the Courses tab. Each row has `is_starred` for the caller.
  listPublicCourses: () => apiClient.get('/api/v1/courses/public'),

  getCourse: (id: number) => apiClient.get(`/api/v1/courses/${id}`),

  createCourse: (payload: {
    title: string;
    description?: string | null;
    visibility?: 'private' | 'admin_assigned' | 'public';
    color?: string | null;
    icon?: string | null;
  }) => apiClient.post('/api/v1/courses/', payload),

  updateCourse: (id: number, payload: {
    title?: string;
    description?: string | null;
    visibility?: 'private' | 'admin_assigned' | 'public';
    color?: string | null;
    icon?: string | null;
  }) => apiClient.put(`/api/v1/courses/${id}`, payload),

  deleteCourse: (id: number) => apiClient.delete(`/api/v1/courses/${id}`),

  // Toggle the caller's "starred" membership on a public course.
  starCourse: (id: number, isStarred: boolean) =>
    apiClient.post(`/api/v1/courses/${id}/star`, { is_starred: isStarred }),

  // ── Course syllabus ───────────────────────────────────────────────────────
  // Returns { user_document_id, extracted, topics[], lecturers[] }.
  getCourseSyllabus: (courseId: number) =>
    apiClient.get(`/api/v1/courses/${courseId}/syllabus`),

  // Attach an existing UserDocument as the course syllabus. Triggers a
  // one-time Gemini extraction on the backend.
  attachCourseSyllabus: (courseId: number, userDocumentId: number) =>
    apiClient.post(`/api/v1/courses/${courseId}/syllabus`, { user_document_id: userDocumentId }),

  detachCourseSyllabus: (courseId: number) =>
    apiClient.delete(`/api/v1/courses/${courseId}/syllabus`),

  // ── Exams ─────────────────────────────────────────────────────────────────
  listCourseExams: (courseId: number) =>
    apiClient.get(`/api/v1/courses/${courseId}/exams`),

  // Aggregated topic / question-type / difficulty stats for the Exams tab.
  // Returned as full sorted lists; the frontend chooses how many to show
  // in the chart vs. the "View all" expander.
  getCourseExamStats: (courseId: number) =>
    apiClient.get(`/api/v1/courses/${courseId}/exam-stats`),

  // Backend runs the full pipeline (extraction → tagging → difficulty) on this
  // call — typical 25-question exam takes 5-15s. Frontend should show a
  // "processing…" state while the request is in flight.
  createCourseExam: (courseId: number, payload: {
    user_document_id: number;
    title:            string;
    year?:            number | null;
    // Three independent metadata axes — backend will auto-fill any field
    // left null/undefined here from the AI extraction.
    semester?:        string | null;
    moed?:            string | null;
    exam_type?:       string | null;
    has_solutions?:   boolean;
    lecturer_ids?:    number[];
  }) => apiClient.post(`/api/v1/courses/${courseId}/exams`, payload),

  getExam: (examId: number) => apiClient.get(`/api/v1/exams/${examId}`),

  // Re-runs the AI pipeline on an exam in 'failed' state. Returns the
  // updated shell with status='pending'; the frontend keeps polling.
  retryExamProcessing: (examId: number) =>
    apiClient.post(`/api/v1/exams/${examId}/retry`),

  deleteExam: (examId: number) => apiClient.delete(`/api/v1/exams/${examId}`),

  // ── Sessions (read-only — sessions are created via /chat or /threads) ────
  listSessions: (limit = 50, offset = 0) =>
    apiClient.get(`/api/v1/sessions/?limit=${limit}&offset=${offset}`),

  searchSessions: (q: string, limit = 50) =>
    apiClient.get(`/api/v1/sessions/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  deleteSession: (id: number) => apiClient.delete(`/api/v1/sessions/${id}`),

  // ── Library — merged sessions + unfiled-files feed for the My Library lane.
  getLibraryRecent: (limit = 40) =>
    apiClient.get(`/api/v1/library/recent?limit=${limit}`),

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
