export interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

export interface Thread {
  id: number;
  page_number: number;
  document_id?: number;
  selected_text: string;
  coordinates: { x: number, y: number, width: number, height: number };
  messages: Message[];
  parent_thread_id?: number | null;
  forked_from_message_id?: number | null;
  title?: string;
  emoji?: string;
}

// ── Personal Hub ────────────────────────────────────────────────────────────

export interface AcademicProfile {
  id: number;
  user_id: number;
  university: string | null;
  degree: string | null;
  current_year: number | null;
  target_gpa: number | null;
  manual_gpa: number | null;
  calculated_gpa: number | null;
  extra_credits: number | null;
  social_links: Record<string, string> | null;
  created_at: string;
}

export interface CourseDetail {
  id: number;
  name: string;
  department: string | null;
  credits: number | null;
  icon_name: string | null;
}

export type CourseStatus = 'active' | 'completed' | 'failed';

export interface CourseRecord {
  id: number;
  user_id: number;
  course_id: number;
  course: CourseDetail | null;
  status: CourseStatus;
  grade: number | null;
  semester_taken: string | null;
  exam_date_a: string | null;
  exam_date_b: string | null;
  is_attendance_mandatory: boolean;
  created_at: string;
}

export type JobStatus = 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn';

export interface JobApplication {
  id: number;
  user_id: number;
  company: string;
  role: string;
  status: JobStatus;
  application_date: string | null;
  debrief_notes: string | null;
  is_debrief_public: boolean;
  created_at: string;
}