// src/features/PersonalHub/CourseRoadmap.tsx
// Grid-based course roadmap with inline Edit and Add Course modals.

import React, { useEffect, useState } from 'react';
import {
  CheckCircle2, Clock, Lock, BookOpen,
  Code, GitBranch, Zap, Database,
  Grid, BarChart2, Workflow, Pencil, Plus, X,
  Trash2, Loader2,
} from 'lucide-react';
import type { CourseRecord, CourseStatus } from '../../types';

// Maps icon_name strings (from the DB) to lucide-react components
const ICON_MAP: Record<string, React.ElementType> = {
  Code,
  GitBranch,
  Zap,
  Database,
  Grid,
  BarChart2,
  BrainCircuit: BookOpen,  // fallback — BrainCircuit needs lucide >=0.400
  Workflow,
};

// ── Status badge ─────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: CourseStatus | 'locked';
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    completed: { label: 'Completed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
    active:    { label: 'In Progress', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200',    Icon: Clock        },
    failed:    { label: 'Failed',      cls: 'bg-red-50 text-red-700 border-red-100',             Icon: BookOpen     },
    locked:    { label: 'Locked',      cls: 'bg-[#F7F7F5] text-[#787774] border-[#E8E8E6]',     Icon: Lock         },
  }[status];

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border ${config.cls}`}>
      <config.Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

// ── Shared form field helpers ─────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium text-[#787774] uppercase tracking-wide block mb-1.5">
      {children}
    </label>
  );
}

const inputCls =
  'w-full bg-white border border-[#E8E8E6] rounded-lg px-3 py-2.5 text-sm text-[#37352F] ' +
  'placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ' +
  'focus:border-indigo-400 transition-colors duration-150';

// ── Edit Course modal ─────────────────────────────────────────────────────────

interface EditModalProps {
  record:  CourseRecord;
  onClose: () => void;
  onSave:  (
    courseUpdates: { name?: string; credits?: number | null },
    recordUpdates: { status?: string; grade?: number | null },
  ) => Promise<void>;
}

function EditModal({ record, onClose, onSave }: EditModalProps) {
  const [name,    setName]    = useState(record.course?.name    ?? '');
  const [credits, setCredits] = useState(record.course?.credits != null ? String(record.course.credits) : '');
  const [status,  setStatus]  = useState<CourseStatus>(record.status);
  const [grade,   setGrade]   = useState(record.grade != null ? String(record.grade) : '');
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const courseUpdates: { name?: string; credits?: number | null } = {};
    const recordUpdates: { status?: string; grade?: number | null } = {};

    const trimmed = name.trim();
    if (trimmed && trimmed !== (record.course?.name ?? '')) courseUpdates.name = trimmed;

    const parsedCr = credits !== '' ? parseFloat(credits) : null;
    if (parsedCr !== (record.course?.credits ?? null)) courseUpdates.credits = parsedCr;

    if (status !== record.status) recordUpdates.status = status;

    const parsedGr = grade !== '' ? parseInt(grade, 10) : null;
    if (parsedGr !== (record.grade ?? null)) recordUpdates.grade = parsedGr;

    await onSave(courseUpdates, recordUpdates);
    setSaving(false);
    onClose();
  }

  const showGrade = status === 'completed' || status === 'failed';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl border border-[#E8E8E6] w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#E8E8E6]">
          <h2 className="text-base font-semibold text-[#37352F]">Edit Course</h2>
          <button onClick={onClose} className="text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] p-1.5 rounded-md transition-colors duration-150">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-4">
          <div>
            <FieldLabel>Course Name</FieldLabel>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className={inputCls}
              placeholder="e.g. Calculus I"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Credits</FieldLabel>
              <input
                type="number"
                value={credits}
                onChange={e => setCredits(e.target.value)}
                className={inputCls}
                placeholder="e.g. 3"
                min="0"
                step="0.5"
              />
            </div>
            <div>
              <FieldLabel>Status</FieldLabel>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as CourseStatus)}
                className={inputCls}
              >
                <option value="active">In Progress</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed / Retake</option>
              </select>
            </div>
          </div>

          {showGrade && (
            <div>
              <FieldLabel>Grade (0–100)</FieldLabel>
              <input
                type="number"
                value={grade}
                onChange={e => setGrade(e.target.value)}
                className={inputCls}
                placeholder="e.g. 85"
                min="0"
                max="100"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#37352F] text-sm font-medium rounded-lg px-4 py-2.5 border border-[#E8E8E6] transition-colors duration-150"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Course modal ──────────────────────────────────────────────────────────

interface AddCourseModalProps {
  onClose: () => void;
  onSave:  (payload: {
    name:        string;
    department?: string | null;
    credits?:    number | null;
    status:      string;
    grade?:      number | null;
  }) => Promise<void>;
}

function AddCourseModal({ onClose, onSave }: AddCourseModalProps) {
  const [name,    setName]    = useState('');
  const [dept,    setDept]    = useState('');
  const [credits, setCredits] = useState('');
  const [status,  setStatus]  = useState<'active' | 'completed'>('active');
  const [grade,   setGrade]   = useState('');
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      name:       name.trim(),
      department: dept.trim() || null,
      credits:    credits !== '' ? parseFloat(credits) : null,
      status,
      grade:      grade !== '' ? parseInt(grade, 10) : null,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl border border-[#E8E8E6] w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#E8E8E6]">
          <h2 className="text-base font-semibold text-[#37352F]">Add Course Manually</h2>
          <button onClick={onClose} className="text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] p-1.5 rounded-md transition-colors duration-150">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-4">
          <div>
            <FieldLabel>Course Name *</FieldLabel>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className={inputCls}
              placeholder="e.g. Calculus I"
              required
            />
          </div>

          <div>
            <FieldLabel>Department</FieldLabel>
            <input
              value={dept}
              onChange={e => setDept(e.target.value)}
              className={inputCls}
              placeholder="e.g. Mathematics"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Credits</FieldLabel>
              <input
                type="number"
                value={credits}
                onChange={e => setCredits(e.target.value)}
                className={inputCls}
                placeholder="e.g. 3"
                min="0"
                step="0.5"
              />
            </div>
            <div>
              <FieldLabel>Status</FieldLabel>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as 'active' | 'completed')}
                className={inputCls}
              >
                <option value="active">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          {status === 'completed' && (
            <div>
              <FieldLabel>Grade (0–100)</FieldLabel>
              <input
                type="number"
                value={grade}
                onChange={e => setGrade(e.target.value)}
                className={inputCls}
                placeholder="e.g. 85"
                min="0"
                max="100"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#37352F] text-sm font-medium rounded-lg px-4 py-2.5 border border-[#E8E8E6] transition-colors duration-150"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Adding…' : 'Add Course'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Course card ───────────────────────────────────────────────────────────────

interface CourseCardProps {
  record:   CourseRecord;
  onEdit:   (record: CourseRecord) => void;
  onDelete: (recordId: number) => Promise<void>;
}

function CourseCard({ record, onEdit, onDelete }: CourseCardProps) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting,    setIsDeleting]    = useState(false);

  const course     = record.course;
  const CourseIcon = ICON_MAP[course?.icon_name ?? ''] ?? BookOpen;

  const examDate = record.exam_date_a
    ? new Date(record.exam_date_a).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : null;

  async function handleDeleteConfirm() {
    setIsDeleting(true);
    await onDelete(record.id);
    setIsDeleting(false);
    setDeleteConfirm(false);
  }

  return (
    <div className="group bg-white border border-[#E8E8E6] rounded-xl p-4 flex flex-col gap-3 hover:border-indigo-200 transition-colors duration-150 relative">

      {/* Action buttons — edit + delete, shown on hover (or during delete confirmation) */}
      {!deleteConfirm ? (
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <button
            onClick={() => onEdit(record)}
            title="Edit course"
            className="text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] p-1 rounded-md transition-colors duration-150"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setDeleteConfirm(true)}
            title="Delete course"
            className="text-[#787774] hover:text-red-500 hover:bg-red-50 p-1 rounded-md transition-colors duration-150"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* Inline delete confirmation — replaces the icon buttons */
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-red-700">Delete?</span>
          <button
            onClick={handleDeleteConfirm}
            disabled={isDeleting}
            className="text-[10px] font-medium bg-red-500 hover:bg-red-600 text-white px-1.5 py-0.5 rounded transition-colors duration-150 disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes'}
          </button>
          <button
            onClick={() => setDeleteConfirm(false)}
            className="text-[10px] font-medium bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#37352F] px-1.5 py-0.5 rounded border border-[#E8E8E6] transition-colors duration-150"
          >
            No
          </button>
        </div>
      )}

      {/* Header — extra right padding so action buttons don't overlap */}
      <div className="flex items-start justify-between gap-2 pr-16">
        <div className="w-8 h-8 rounded-lg bg-[#F7F7F5] flex items-center justify-center shrink-0">
          <CourseIcon className="w-4 h-4 text-[#787774]" />
        </div>
        <StatusBadge status={record.status} />
      </div>

      {/* Name + department */}
      <div>
        <p className="text-sm font-medium text-[#37352F] leading-snug">{course?.name ?? '—'}</p>
        {course?.department && (
          <p className="text-xs text-[#787774] mt-0.5">{course.department}</p>
        )}
        {record.semester_taken && (
          <p className="text-[10px] text-[#C4C4C4] mt-0.5">{record.semester_taken}</p>
        )}
      </div>

      {/* Footer: credits left, grade or exam date right */}
      <div className="flex items-center justify-between text-xs text-[#787774] mt-auto pt-2 border-t border-[#E8E8E6]">
        <span>{course?.credits != null ? `${course.credits} cr` : '—'}</span>
        {record.status === 'completed' && record.grade != null ? (
          <span className="font-medium text-[#37352F]">{record.grade}</span>
        ) : examDate ? (
          <span>{examDate}</span>
        ) : (
          <span>—</span>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface CourseRoadmapProps {
  courses:        CourseRecord[];
  onEditCourse:   (
    recordId:      number,
    courseId:      number,
    courseUpdates: { name?: string; credits?: number | null },
    recordUpdates: { status?: string; grade?: number | null },
  ) => Promise<void>;
  onAddCourse:    (payload: {
    name:        string;
    department?: string | null;
    credits?:    number | null;
    status:      string;
    grade?:      number | null;
  }) => Promise<void>;
  onDeleteCourse: (recordId: number) => Promise<void>;
}

export default function CourseRoadmap({ courses, onEditCourse, onAddCourse, onDeleteCourse }: CourseRoadmapProps) {
  const [editRecord, setEditRecord] = useState<CourseRecord | null>(null);
  const [showAdd,    setShowAdd]    = useState(false);

  const completed = courses.filter(c => c.status === 'completed');
  const active    = courses.filter(c => c.status === 'active');
  const failed    = courses.filter(c => c.status === 'failed');

  async function handleEditSave(
    courseUpdates: { name?: string; credits?: number | null },
    recordUpdates: { status?: string; grade?: number | null },
  ) {
    if (!editRecord) return;
    await onEditCourse(editRecord.id, editRecord.course_id, courseUpdates, recordUpdates);
  }

  function Section({ title, records }: { title: string; records: CourseRecord[] }) {
    if (records.length === 0) return null;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[#787774] uppercase tracking-wide">{title}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {records.map(r => (
            <CourseCard key={r.id} record={r} onEdit={setEditRecord} onDelete={onDeleteCourse} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Section header with Add Course button */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#787774]">
          {courses.length === 0
            ? 'No courses yet — upload a transcript or add one manually.'
            : `${courses.length} course${courses.length !== 1 ? 's' : ''} total`}
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#37352F] text-sm font-medium rounded-lg px-3 py-2 border border-[#E8E8E6] transition-colors duration-150"
        >
          <Plus className="w-4 h-4" />
          Add Course
        </button>
      </div>

      {courses.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-[#787774]">
          <BookOpen className="w-8 h-8 opacity-40" />
          <p className="text-sm">Upload a transcript or add a course manually to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <Section title="In Progress" records={active}    />
          <Section title="Completed"   records={completed} />
          {failed.length > 0 && <Section title="Needs Retake" records={failed} />}
        </div>
      )}

      {editRecord && (
        <EditModal
          record={editRecord}
          onClose={() => setEditRecord(null)}
          onSave={handleEditSave}
        />
      )}

      {showAdd && (
        <AddCourseModal
          onClose={() => setShowAdd(false)}
          onSave={onAddCourse}
        />
      )}
    </>
  );
}
