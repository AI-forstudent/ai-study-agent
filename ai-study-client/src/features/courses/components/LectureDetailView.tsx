// Compatibility re-export — the implementation moved to LectureSessionView.tsx
// when F-033 turned the lecture page into a session-style viewer with tabs
// and lecture-scoped chat. Existing imports of `LectureDetailView` and the
// `Lecture` type continue to work.
export { default } from './LectureSessionView';
export type { Lecture } from './LectureSessionView';
