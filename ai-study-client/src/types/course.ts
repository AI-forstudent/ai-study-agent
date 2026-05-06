/**
 * Shared Course / Session / Library-feed types.
 *
 * Matches the Pydantic responses in:
 *   - backend/app/api/routers/courses.py
 *   - backend/app/api/routers/sessions.py
 *   - backend/app/api/routers/library.py
 */

export type CourseVisibility = 'private' | 'admin_assigned' | 'public';

/** Caller's role on a course. `null` = public course not yet starred. */
export type CourseRole = 'owner' | 'admin_assigned' | 'starred' | null;

export interface Course {
  id:               number;
  owner_id:         number;
  title:            string;
  description:      string | null;
  visibility:       CourseVisibility;
  color:            string | null;
  icon:             string | null;
  created_at:       string;
  role:             CourseRole;
  folder_count:     number;
  document_count:   number;
}

export interface PublicCourse {
  id:             number;
  title:          string;
  description:    string | null;
  color:          string | null;
  icon:           string | null;
  created_at:     string;
  owner_email:    string;
  is_starred:     boolean;
  document_count: number;
}

/** Session card used in the My Library lane and the Sessions search page. */
export interface SessionCard {
  id:              number;
  title:           string | null;
  emoji:           string | null;
  document_id:     number | null;
  document_title:  string | null;
  persona_id:      string | null;
  selected_text:   string | null;
  last_message:    string | null;
  message_count:   number;
  created_at:      string;
}

/** Tagged-union row from /api/v1/library/recent. */
export type LibraryFeedItem =
  | {
      kind:            'session';
      sort_at:         string;
      session_id:      number;
      session_title:   string | null;
      session_emoji:   string | null;
      session_preview: string | null;
      message_count:   number;
      document_id:     number | null;
      document_title:  string | null;
    }
  | {
      kind:           'file';
      sort_at:        string;
      file_id:        number;
      file_title:     string;
      file_doc_type:  string;
      file_path:      string | null;
      is_starred:     boolean;
      is_public:      boolean;
    };

// ── Syllabus types ──────────────────────────────────────────────────────────

export interface CourseLecturer {
  id:    number;
  name:  string;
  email: string | null;
  role:  string;
}

export interface CourseTopic {
  id:     number;
  name:   string;
  source: string;   // 'syllabus' | 'lecture' | 'exam_inferred'
}

/** Output shape of services/syllabus_extractor.extract_syllabus. */
export interface SyllabusExtraction {
  topics:           string[];
  books:            string[];
  lecturers:        { name: string; email: string | null; role: string }[];
  grading_policy:   string | null;
  prerequisites:    string[];
  weekly_breakdown: { week: number; topic: string }[];
  course_code:      string | null;
  institution:      string | null;
  semester:         string | null;
  language:         string | null;
}

export interface CourseSyllabus {
  user_document_id: number | null;
  extracted:        SyllabusExtraction | null;
  topics:           CourseTopic[];
  lecturers:        CourseLecturer[];
}

// ── Exam types ──────────────────────────────────────────────────────────────

export interface QuestionType {
  id:   number;
  name: string;
}

export interface ExamLecturer {
  id:   number;
  name: string;
  role: string;
}

export interface ExamTopic {
  id:   number;
  name: string;
}

/** A single extracted question — used in the exam detail view. */
export interface ExamQuestion {
  id:                  number;
  question_number:     string;
  question_text:       string;
  page_number:         number | null;
  question_type:       QuestionType | null;
  topics:              ExamTopic[];
  difficulty_score:    number | null;
  reference_solution:  string | null;
}

export type ExamProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Compact card shape used by the exam list table. */
export interface ExamCard {
  id:                    number;
  title:                 string;
  year:                  number | null;
  semester:              string | null;
  has_solutions:         boolean;
  aggregate_difficulty:  number | null;
  question_count:        number;
  topics:                ExamTopic[];
  lecturers:             ExamLecturer[];
  /** Async-processing state. Frontend polls while any exam is 'pending'/'processing'. */
  processing_status:     ExamProcessingStatus;
  processing_error:      string | null;
  processed_at:          string | null;
  created_at:            string;
}

/** Full detail returned by GET /api/v1/exams/{id}. */
export interface ExamDetail extends ExamCard {
  questions: ExamQuestion[];
}
