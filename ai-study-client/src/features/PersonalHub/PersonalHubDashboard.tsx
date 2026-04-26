// src/features/PersonalHub/PersonalHubDashboard.tsx
// Main Personal Hub view: vital stats, dual-file upload dropdown, roadmap + job tabs,
// and a Danger Zone for resetting all imported course data.

import React, { useEffect, useRef, useState } from 'react';
import {
  GraduationCap, Target, Loader2,
  Linkedin, Github, AlertCircle, CheckCircle2,
  Map, Briefcase, ChevronDown, FileText, ClipboardList,
  Trash2, Upload, Award,
} from 'lucide-react';

import { usePersonalHub } from './usePersonalHub';
import CourseRoadmap     from './CourseRoadmap';
import JobTracker        from './JobTracker';

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label:  string;
  value:  string | number | null;
  sub?:   string;
  icon:   React.ElementType;
  accent?: boolean;
}

function StatCard({ label, value, sub, icon: Icon, accent }: StatCardProps) {
  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl p-4 flex items-start gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${accent ? 'bg-indigo-50' : 'bg-[#F7F7F5]'}`}>
        <Icon className={`w-4 h-4 ${accent ? 'text-indigo-600' : 'text-[#787774]'}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[#787774] font-medium uppercase tracking-wide">{label}</p>
        <p className="text-xl font-semibold text-[#37352F] mt-0.5 leading-none">
          {value ?? <span className="text-[#C4C4C4] text-base">—</span>}
        </p>
        {sub && <p className="text-xs text-[#787774] mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ── GPA ring (SVG progress arc) ───────────────────────────────────────────────

function GpaRing({ value, target }: { value: number | null; target: number | null }) {
  const pct  = value != null && target != null && target > 0 ? Math.min(value / target, 1) : 0;
  const r    = 28;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - pct);

  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl p-4 flex items-center gap-4">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#F7F7F5" strokeWidth="6" />
        <circle
          cx="36" cy="36" r={r}
          fill="none" stroke="#4F46E5" strokeWidth="6"
          strokeDasharray={circ}
          strokeDashoffset={dash}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text x="36" y="40" textAnchor="middle" fontSize="13" fontWeight="600" fill="#37352F">
          {value != null ? value.toFixed(1) : '—'}
        </text>
      </svg>
      <div>
        <p className="text-xs text-[#787774] font-medium uppercase tracking-wide">Calculated GPA</p>
        {target != null && (
          <p className="text-xs text-[#787774] mt-1">
            Target: <span className="font-medium text-[#37352F]">{target}</span>
          </p>
        )}
        {value != null && target != null && (
          <p className="text-xs text-[#787774] mt-0.5">
            {value >= target
              ? <span className="text-emerald-600 font-medium">On track</span>
              : <span className="text-amber-600 font-medium">{(target - value).toFixed(1)} pts to go</span>}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'roadmap', label: 'Course Roadmap', icon: Map       },
  { id: 'jobs',    label: 'Job Tracker',    icon: Briefcase },
] as const;

type TabId = typeof TABS[number]['id'];

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function PersonalHubDashboard() {
  const {
    profile, courses, jobs, isLoading, error,
    isUploading, uploadResult,
    uploadTranscript, updateJobStatus,
    resetAllCourses, deleteCourse, addManualCourse, editCourse,
  } = usePersonalHub();

  const [activeTab,      setActiveTab]      = useState<TabId>('roadmap');
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [resetConfirm,   setResetConfirm]   = useState(false);
  const [isResetting,    setIsResetting]    = useState(false);

  const transcriptRef  = useRef<HTMLInputElement>(null);
  const curriculumRef  = useRef<HTMLInputElement>(null);
  const uploadMenuRef  = useRef<HTMLDivElement>(null);

  // Close the upload dropdown when the user clicks anywhere outside it
  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) {
        setUploadMenuOpen(false);
      }
    }
    if (uploadMenuOpen) document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [uploadMenuOpen]);

  const effectiveGpa = profile?.manual_gpa ?? profile?.calculated_gpa ?? null;

  async function handleReset() {
    setIsResetting(true);
    await resetAllCourses();
    setIsResetting(false);
    setResetConfirm(false);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-32 text-[#787774]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading Personal Hub…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-5 max-w-6xl mx-auto w-full flex flex-col gap-6">

        {/* ── Page header ──────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#37352F]">Personal Hub</h1>
            {profile?.university && (
              <p className="text-sm text-[#787774] mt-0.5">
                {profile.degree ?? 'Student'} · {profile.university}
                {profile.current_year != null && ` · Year ${profile.current_year}`}
              </p>
            )}
          </div>

          {/* Social links */}
          <div className="flex items-center gap-2 shrink-0">
            {profile?.social_links?.linkedin && (
              <a
                href={profile.social_links.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] p-1.5 rounded-md transition-colors duration-150"
              >
                <Linkedin className="w-4 h-4" />
              </a>
            )}
            {profile?.social_links?.github && (
              <a
                href={profile.social_links.github}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] p-1.5 rounded-md transition-colors duration-150"
              >
                <Github className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {/* ── Error banner ─────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* ── Upload result banner ─────────────────────────────────────── */}
        {uploadResult && (
          <div className="flex items-start gap-2.5 p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            Transcript imported — {uploadResult.upserted_count} courses upserted.
            {uploadResult.calculated_gpa != null && (
              <> New GPA: <strong>{uploadResult.calculated_gpa.toFixed(2)}</strong></>
            )}
          </div>
        )}

        {/* ── Stats row ─────────────────────────────────────────────────── */}
        {(() => {
          const completedCourses = courses.filter(c => c.status === 'completed');
          const creditsEarned = completedCourses.reduce((sum, c) => sum + (c.course?.credits ?? 0), 0);
          const creditsTotal  = courses.reduce((sum, c) => sum + (c.course?.credits ?? 0), 0);
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <GpaRing value={effectiveGpa} target={profile?.target_gpa ?? null} />
              <StatCard
                label="Courses Completed"
                value={completedCourses.length}
                sub={`of ${courses.length} total`}
                icon={GraduationCap}
              />
              <StatCard
                label="Active Courses"
                value={courses.filter(c => c.status === 'active').length}
                icon={Target}
                accent
              />
              <StatCard
                label="Credits Earned"
                value={creditsEarned > 0 ? creditsEarned : null}
                sub={creditsTotal > 0 ? `of ${creditsTotal} enrolled` : undefined}
                icon={Award}
              />
              <StatCard
                label="Applications"
                value={jobs.length}
                sub={`${jobs.filter(j => j.status === 'interview' || j.status === 'offer').length} in active stage`}
                icon={Briefcase}
              />
            </div>
          );
        })()}

        {/* ── Dual upload dropdown ─────────────────────────────────────── */}
        {/*
          Both options call the same /profile/transcript endpoint for now.
          The visual distinction primes the user for the future dual-namespace concept:
          curriculum (global catalog) vs. transcript (personal grades).
        */}
        <div className="flex items-center gap-3">

          {/* Hidden file inputs — triggered programmatically */}
          <input
            ref={transcriptRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) uploadTranscript(file);
              e.target.value = '';
            }}
          />
          <input
            ref={curriculumRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) uploadTranscript(file);
              e.target.value = '';
            }}
          />

          <div ref={uploadMenuRef} className="relative">
            <button
              onClick={() => setUploadMenuOpen(v => !v)}
              disabled={isUploading}
              className="inline-flex items-center gap-2 bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#37352F] text-sm font-medium rounded-lg px-4 py-2.5 border border-[#E8E8E6] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Parsing…</>
                : <><Upload className="w-4 h-4" /> Import Academic Data <ChevronDown className="w-3.5 h-3.5 ml-0.5" /></>
              }
            </button>

            {uploadMenuOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-72 bg-white border border-[#E8E8E6] rounded-xl shadow-lg z-20 py-1.5 overflow-hidden">
                {/* Option 1: Degree Curriculum */}
                <button
                  onClick={() => { curriculumRef.current?.click(); setUploadMenuOpen(false); }}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-[#F7F7F5] transition-colors duration-150 text-start"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#37352F]">Upload Degree Curriculum</p>
                    <p className="text-xs text-[#787774] mt-0.5">Syllabus or full course list PDF</p>
                  </div>
                </button>

                <div className="border-t border-[#E8E8E6] mx-3" />

                {/* Option 2: Personal Transcript (Grades) */}
                <button
                  onClick={() => { transcriptRef.current?.click(); setUploadMenuOpen(false); }}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-[#F7F7F5] transition-colors duration-150 text-start"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0 mt-0.5">
                    <ClipboardList className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#37352F]">Upload Personal Transcript</p>
                    <p className="text-xs text-[#787774] mt-0.5">Grades & GPA — Gemini will parse it</p>
                  </div>
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-[#787774]">
            Gemini will extract courses and grades automatically.
          </p>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 border-b border-[#E8E8E6]">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 -mb-px ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-[#787774] hover:text-[#37352F]'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ───────────────────────────────────────────────── */}
        {activeTab === 'roadmap' && (
          <CourseRoadmap
            courses={courses}
            onEditCourse={editCourse}
            onAddCourse={addManualCourse}
            onDeleteCourse={deleteCourse}
          />
        )}
        {activeTab === 'jobs' && (
          <JobTracker jobs={jobs} onStatusChange={updateJobStatus} />
        )}

        {/* ── Danger Zone ───────────────────────────────────────────────── */}
        <div className="border border-red-100 rounded-xl p-4 bg-red-50/30">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-3">Danger Zone</p>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium text-[#37352F]">Reset Course Data</p>
              <p className="text-xs text-[#787774] mt-0.5">
                Delete all imported courses so you can re-upload your transcript from scratch.
              </p>
            </div>

            {!resetConfirm ? (
              <button
                onClick={() => setResetConfirm(true)}
                className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors duration-150 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
                Reset
              </button>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-red-700 font-medium">Are you sure?</span>
                <button
                  onClick={handleReset}
                  disabled={isResetting}
                  className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                </button>
                <button
                  onClick={() => setResetConfirm(false)}
                  className="bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#37352F] text-sm font-medium rounded-lg px-3 py-2 border border-[#E8E8E6] transition-colors duration-150"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="h-8" />
      </div>
    </div>
  );
}
