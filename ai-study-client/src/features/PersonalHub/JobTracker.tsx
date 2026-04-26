// src/features/PersonalHub/JobTracker.tsx
// Kanban-style job application tracker with debrief notes expansion.

import React, { useState } from 'react';
import {
  Briefcase, ChevronDown, ChevronUp,
  SendHorizonal, MessageSquare, Trophy, XCircle, MinusCircle,
} from 'lucide-react';
import type { JobApplication, JobStatus } from '../../types';

// ── Status config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<JobStatus, { label: string; className: string; icon: React.ElementType }> = {
  applied: {
    label: 'Applied',
    className: 'bg-[#F7F7F5] text-[#787774] border-[#E8E8E6]',
    icon: SendHorizonal,
  },
  interview: {
    label: 'Interview',
    className: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    icon: MessageSquare,
  },
  offer: {
    label: 'Offer',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: Trophy,
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-50 text-red-700 border-red-100',
    icon: XCircle,
  },
  withdrawn: {
    label: 'Withdrawn',
    className: 'bg-amber-50 text-amber-700 border-amber-100',
    icon: MinusCircle,
  },
};

// ── Job card ────────────────────────────────────────────────────────────────

interface JobCardProps {
  job: JobApplication;
  onStatusChange: (jobId: number, status: string) => void;
}

function JobCard({ job, onStatusChange }: JobCardProps) {
  const [debrief, setDebrief] = useState(false);
  const config = STATUS_CONFIG[job.status];
  const StatusIcon = config.icon;

  const appDate = job.application_date
    ? new Date(job.application_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#F7F7F5] flex items-center justify-center shrink-0 mt-0.5">
            <Briefcase className="w-4 h-4 text-[#787774]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#37352F] truncate">{job.company}</p>
            <p className="text-xs text-[#787774] truncate">{job.role}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border shrink-0 ${config.className}`}>
          <StatusIcon className="w-3 h-3" />
          {config.label}
        </span>
      </div>

      {/* Date + quick status change */}
      <div className="flex items-center justify-between text-xs text-[#787774]">
        <span>{appDate ?? 'No date'}</span>
        <select
          value={job.status}
          onChange={e => onStatusChange(job.id, e.target.value)}
          className="text-xs border border-[#E8E8E6] rounded-md px-2 py-1 bg-white text-[#37352F] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
        >
          {Object.entries(STATUS_CONFIG).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
      </div>

      {/* Debrief notes toggle */}
      {job.debrief_notes && (
        <>
          <div className="border-t border-[#E8E8E6]" />
          <button
            onClick={() => setDebrief(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-[#787774] hover:text-[#37352F] transition-colors duration-150 text-start"
          >
            {debrief ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Interview Debrief
            {job.is_debrief_public && (
              <span className="ml-1 inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Public
              </span>
            )}
          </button>
          {debrief && (
            <p className="text-xs text-[#37352F] leading-relaxed bg-[#F7F7F5] rounded-lg p-3 whitespace-pre-wrap">
              {job.debrief_notes}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface JobTrackerProps {
  jobs: JobApplication[];
  onStatusChange: (jobId: number, status: string) => void;
}

const PIPELINE_ORDER: JobStatus[] = ['applied', 'interview', 'offer', 'rejected', 'withdrawn'];

export default function JobTracker({ jobs, onStatusChange }: JobTrackerProps) {
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-[#787774]">
        <Briefcase className="w-8 h-8 opacity-40" />
        <p className="text-sm">No applications tracked yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {PIPELINE_ORDER.map(status => {
        const group = jobs.filter(j => j.status === status);
        if (group.length === 0) return null;
        const config = STATUS_CONFIG[status];
        return (
          <div key={status} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border ${config.className}`}>
                <config.icon className="w-3 h-3" />
                {config.label}
              </span>
              <span className="text-xs text-[#787774]">{group.length}</span>
            </div>
            {group.map(job => (
              <JobCard key={job.id} job={job} onStatusChange={onStatusChange} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
