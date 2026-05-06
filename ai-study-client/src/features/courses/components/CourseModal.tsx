import { useEffect, useState } from 'react';
import { X, GraduationCap, Globe, Lock, Users, Save, Trash2 } from 'lucide-react';
import type { Course, CourseVisibility } from '../../../types/course';
import { api } from '../../../services/api';

interface CourseModalProps {
  isOpen: boolean;
  /** When set, the modal opens in edit mode for this course; otherwise create. */
  editing?: Course | null;
  onClose: () => void;
  onSaved: (course: Course) => void;
  onDeleted?: (courseId: number) => void;
}

const COLORS = [
  '#6366F1', '#0EA5E9', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#8B5CF6', '#64748B',
];

export default function CourseModal({ isOpen, editing, onClose, onSaved, onDeleted }: CourseModalProps) {
  const [title, setTitle]                 = useState('');
  const [description, setDescription]     = useState('');
  const [visibility, setVisibility]       = useState<CourseVisibility>('private');
  const [color, setColor]                 = useState<string>(COLORS[0]);
  const [icon, setIcon]                   = useState<string>('🎓');
  const [isSaving, setIsSaving]           = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  // Hydrate from `editing` on open.
  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description ?? '');
      setVisibility(editing.visibility);
      setColor(editing.color ?? COLORS[0]);
      setIcon(editing.icon ?? '🎓');
    } else {
      setTitle('');
      setDescription('');
      setVisibility('private');
      setColor(COLORS[0]);
      setIcon('🎓');
    }
    setError(null);
  }, [isOpen, editing]);

  // Esc to close.
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        visibility,
        color,
        icon: icon.trim() || null,
      };
      const res = editing
        ? await api.updateCourse(editing.id, payload)
        : await api.createCourse(payload);
      onSaved(res.data);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to save course.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!confirm(`Delete "${editing.title}"? Folders inside will be detached but kept.`)) return;
    try {
      await api.deleteCourse(editing.id);
      onDeleted?.(editing.id);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to delete course.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-[#E8E8E6] w-full max-w-md flex flex-col"
        dir="ltr"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8E8E6]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <GraduationCap className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-[#37352F]">
              {editing ? 'Edit course' : 'New course'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] transition-colors duration-150"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="p-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <div className="shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Icon</p>
              <input
                value={icon}
                onChange={e => setIcon(e.target.value)}
                maxLength={2}
                className="w-14 h-10 text-center text-xl border border-[#E8E8E6] rounded-lg bg-[#F7F7F5] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
              />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Title</p>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Linear Algebra 1"
                autoFocus
                className="w-full h-10 px-3 border border-[#E8E8E6] rounded-lg text-sm text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
              />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Description</p>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What's this course about?"
              rows={3}
              className="w-full px-3 py-2 border border-[#E8E8E6] rounded-lg text-sm text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150 resize-none"
            />
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Color</p>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-lg transition-all duration-150 ${
                    color === c ? 'ring-2 ring-offset-2 ring-indigo-500' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Visibility</p>
            <div className="flex flex-col gap-1.5">
              {[
                { v: 'private',        label: 'Private',         desc: 'Only you can see it.',                       icon: Lock },
                { v: 'admin_assigned', label: 'Admin-assigned',  desc: 'Visible only to users granted access.',       icon: Users },
                { v: 'public',         label: 'Public',          desc: 'Listed in the Courses tab; anyone can star.', icon: Globe },
              ].map(opt => {
                const Icon = opt.icon;
                const active = visibility === (opt.v as CourseVisibility);
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setVisibility(opt.v as CourseVisibility)}
                    className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border text-start transition-colors duration-150 ${
                      active
                        ? 'bg-indigo-50 border-indigo-300'
                        : 'bg-white border-[#E8E8E6] hover:bg-[#F7F7F5]'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${active ? 'text-indigo-600' : 'text-[#C4C4C4]'}`} />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${active ? 'text-[#37352F]' : 'text-[#787774]'}`}>
                        {opt.label}
                      </p>
                      <p className="text-[10px] text-[#787774]">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#E8E8E6] flex items-center justify-between">
          {editing && onDeleted ? (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-150"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          ) : <span />}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition-colors duration-150"
          >
            <Save className="w-3.5 h-3.5" />
            {isSaving ? 'Saving…' : editing ? 'Save Changes' : 'Create Course'}
          </button>
        </div>
      </div>
    </div>
  );
}
