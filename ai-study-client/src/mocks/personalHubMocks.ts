// src/mocks/personalHubMocks.ts
// Typed mock data mirroring the Personal Hub API response shapes.
// Used for UI development and visual testing when the backend is unavailable.

import type { AcademicProfile, CourseRecord, JobApplication } from '../types';

export const MOCK_PROFILE: AcademicProfile = {
  id: 1,
  user_id: 1,
  university: 'Ben-Gurion University of the Negev',
  degree: 'B.Sc. Data Engineering',
  current_year: 2,
  target_gpa: 85.0,
  manual_gpa: null,
  calculated_gpa: 86.6,
  extra_credits: 3.0,
  social_links: {
    linkedin: 'https://linkedin.com/in/dvir',
    github:   'https://github.com/dvir',
  },
  created_at: '2026-01-10T10:00:00.000Z',
};

export const MOCK_COURSES: CourseRecord[] = [
  {
    id: 1, user_id: 1, course_id: 1,
    course: { id: 1, name: 'Introduction to Programming', department: 'Computer Science', credits: 3.0, icon_name: 'Code' },
    status: 'completed', grade: 92, exam_date_a: '2024-02-05T00:00:00.000Z', exam_date_b: null, is_attendance_mandatory: false, created_at: '2024-01-10T00:00:00.000Z',
  },
  {
    id: 2, user_id: 1, course_id: 2,
    course: { id: 2, name: 'Data Structures', department: 'Computer Science', credits: 4.0, icon_name: 'GitBranch' },
    status: 'completed', grade: 88, exam_date_a: '2024-06-20T00:00:00.000Z', exam_date_b: null, is_attendance_mandatory: false, created_at: '2024-02-15T00:00:00.000Z',
  },
  {
    id: 3, user_id: 1, course_id: 3,
    course: { id: 3, name: 'Algorithms', department: 'Computer Science', credits: 4.0, icon_name: 'Zap' },
    status: 'completed', grade: 84, exam_date_a: '2024-06-25T00:00:00.000Z', exam_date_b: null, is_attendance_mandatory: true, created_at: '2024-02-15T00:00:00.000Z',
  },
  {
    id: 4, user_id: 1, course_id: 4,
    course: { id: 4, name: 'Databases', department: 'Data Engineering', credits: 3.0, icon_name: 'Database' },
    status: 'completed', grade: 91, exam_date_a: '2024-06-22T00:00:00.000Z', exam_date_b: null, is_attendance_mandatory: false, created_at: '2024-02-15T00:00:00.000Z',
  },
  {
    id: 5, user_id: 1, course_id: 5,
    course: { id: 5, name: 'Linear Algebra', department: 'Mathematics', credits: 4.0, icon_name: 'Grid' },
    status: 'completed', grade: 78, exam_date_a: '2024-06-18T00:00:00.000Z', exam_date_b: null, is_attendance_mandatory: true, created_at: '2024-02-15T00:00:00.000Z',
  },
  {
    id: 6, user_id: 1, course_id: 6,
    course: { id: 6, name: 'Probability & Statistics', department: 'Mathematics', credits: 4.0, icon_name: 'BarChart2' },
    status: 'active', grade: null, exam_date_a: '2026-06-15T00:00:00.000Z', exam_date_b: null, is_attendance_mandatory: false, created_at: '2026-02-10T00:00:00.000Z',
  },
  {
    id: 7, user_id: 1, course_id: 7,
    course: { id: 7, name: 'Machine Learning', department: 'Data Engineering', credits: 4.0, icon_name: 'BrainCircuit' },
    status: 'active', grade: null, exam_date_a: '2026-06-28T00:00:00.000Z', exam_date_b: null, is_attendance_mandatory: true, created_at: '2026-02-10T00:00:00.000Z',
  },
];

export const MOCK_JOBS: JobApplication[] = [
  {
    id: 1, user_id: 1,
    company: 'Google',
    role: 'Software Engineer Intern',
    status: 'interview',
    application_date: '2026-03-10T00:00:00.000Z',
    debrief_notes:
      'First round was a live coding session on LeetCode-medium graphs. ' +
      'Solved it but was too slow on the follow-up. ' +
      'Lesson: practice timed graph traversal — BFS/DFS must be automatic. ' +
      'Second round scheduled next month.',
    is_debrief_public: true,
    created_at: '2026-03-10T00:00:00.000Z',
  },
  {
    id: 2, user_id: 1,
    company: 'Wix',
    role: 'Data Engineering Intern',
    status: 'applied',
    application_date: '2026-04-01T00:00:00.000Z',
    debrief_notes: null,
    is_debrief_public: false,
    created_at: '2026-04-01T00:00:00.000Z',
  },
];
