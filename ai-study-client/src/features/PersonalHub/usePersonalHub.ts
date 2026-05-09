// src/features/PersonalHub/usePersonalHub.ts
// Data-fetching hook for Personal Hub — keeps all API calls out of view components.

import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import type { AcademicProfile, CourseRecord, JobApplication } from '../../types';

interface PersonalHubState {
  profile:      AcademicProfile | null;
  courses:      CourseRecord[];
  jobs:         JobApplication[];
  isLoading:    boolean;
  error:        string | null;
  isUploading:  boolean;
  uploadResult: { upserted_count: number; calculated_gpa: number | null } | null;
}

interface ManualCoursePayload {
  name:        string;
  department?: string | null;
  credits?:    number | null;
  status:      string;
  grade?:      number | null;
}

interface PersonalHubActions {
  refetch:            () => void;
  uploadTranscript:   (file: File) => Promise<void>;
  updateProfile:      (payload: Partial<AcademicProfile>) => Promise<void>;
  updateJobStatus:    (jobId: number, status: string) => Promise<void>;
  updateCourseStatus: (recordId: number, status: string, grade?: number | null) => Promise<void>;
  // CRUD extensions
  resetAllCourses:    () => Promise<void>;
  deleteCourse:       (recordId: number) => Promise<void>;
  addManualCourse:    (payload: ManualCoursePayload) => Promise<void>;
  editCourse:         (
    recordId:      number,
    courseId:      number,
    courseUpdates: { name?: string; credits?: number | null },
    recordUpdates: { status?: string; grade?: number | null },
  ) => Promise<void>;
}

export function usePersonalHub(): PersonalHubState & PersonalHubActions {
  const [profile,      setProfile]      = useState<AcademicProfile | null>(null);
  const [courses,      setCourses]      = useState<CourseRecord[]>([]);
  const [jobs,         setJobs]         = useState<JobApplication[]>([]);
  const [isLoading,    setIsLoading]    = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [isUploading,  setIsUploading]  = useState(false);
  const [uploadResult, setUploadResult] = useState<{ upserted_count: number; calculated_gpa: number | null } | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [profileRes, coursesRes, jobsRes] = await Promise.all([
        api.getProfile(),
        api.getCourseRecords(),
        api.getJobApplications(),
      ]);
      setProfile(profileRes.data);
      setCourses(coursesRes.data);
      setJobs(jobsRes.data);
    } catch {
      setError('Failed to load My Space data. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const uploadTranscript = useCallback(async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const res = await api.uploadTranscript(file);
      setUploadResult({
        upserted_count: res.data.upserted_count,
        calculated_gpa: res.data.calculated_gpa,
      });
      // Refresh courses and profile after a transcript upsert
      const [profileRes, coursesRes] = await Promise.all([
        api.getProfile(),
        api.getCourseRecords(),
      ]);
      setProfile(profileRes.data);
      setCourses(coursesRes.data);
    } catch {
      setError('Transcript upload failed. Ensure the file is a valid PDF.');
    } finally {
      setIsUploading(false);
    }
  }, []);

  const updateProfile = useCallback(async (payload: Partial<AcademicProfile>) => {
    try {
      const res = await api.updateProfile(payload as Record<string, unknown>);
      setProfile(res.data);
    } catch {
      setError('Failed to update profile.');
    }
  }, []);

  const updateJobStatus = useCallback(async (jobId: number, status: string) => {
    try {
      const res = await api.updateJobApplication(jobId, { status });
      setJobs(prev => prev.map(j => (j.id === jobId ? res.data : j)));
    } catch {
      setError('Failed to update job status.');
    }
  }, []);

  const updateCourseStatus = useCallback(async (recordId: number, status: string, grade?: number | null) => {
    try {
      const res = await api.updateCourseRecord(recordId, { status, ...(grade !== undefined ? { grade } : {}) });
      setCourses(prev => prev.map(c => (c.id === recordId ? res.data : c)));
      // Refresh profile so calculated_gpa updates
      const profileRes = await api.getProfile();
      setProfile(profileRes.data);
    } catch {
      setError('Failed to update course record.');
    }
  }, []);

  // Remove a single course record and refresh state + GPA
  const deleteCourse = useCallback(async (recordId: number) => {
    try {
      await api.deleteCourseRecord(recordId);
      setCourses(prev => prev.filter(c => c.id !== recordId));
      // Refresh profile so calculated_gpa reflects the removed course
      const profileRes = await api.getProfile();
      setProfile(profileRes.data);
    } catch {
      setError('Failed to delete course record.');
    }
  }, []);

  // Delete every course record for the current user (clean slate before re-import)
  const resetAllCourses = useCallback(async () => {
    try {
      await api.resetCourseRecords();
      setCourses([]);
      const profileRes = await api.getProfile();
      setProfile(profileRes.data);
    } catch {
      setError('Failed to reset course data.');
    }
  }, []);

  // Create a catalog entry then add the student record; refresh both state slices
  const addManualCourse = useCallback(async (payload: ManualCoursePayload) => {
    try {
      const catalogRes = await api.createCatalogEntry({
        name:       payload.name,
        credits:    payload.credits,
        department: payload.department,
      });
      await api.addCourseRecord({
        course_id: catalogRes.data.id,
        status:    payload.status,
        grade:     payload.grade ?? null,
      });
      // Full refresh ensures the joined `course` object is present on the new record
      const [coursesRes, profileRes] = await Promise.all([
        api.getCourseRecords(),
        api.getProfile(),
      ]);
      setCourses(coursesRes.data);
      setProfile(profileRes.data);
    } catch {
      setError('Failed to add course.');
    }
  }, []);

  // Patch catalog fields (name/credits) and/or record fields (status/grade) in one call
  const editCourse = useCallback(async (
    recordId:      number,
    courseId:      number,
    courseUpdates: { name?: string; credits?: number | null },
    recordUpdates: { status?: string; grade?: number | null },
  ) => {
    try {
      const promises: Promise<unknown>[] = [];
      if (Object.keys(courseUpdates).length > 0) {
        promises.push(api.updateCatalogEntry(courseId, courseUpdates));
      }
      if (Object.keys(recordUpdates).length > 0) {
        promises.push(api.updateCourseRecord(recordId, recordUpdates));
      }
      if (promises.length === 0) return;
      await Promise.all(promises);
      // Refresh so the UI reflects changes to the joined course object
      const [coursesRes, profileRes] = await Promise.all([
        api.getCourseRecords(),
        api.getProfile(),
      ]);
      setCourses(coursesRes.data);
      setProfile(profileRes.data);
    } catch {
      setError('Failed to update course.');
    }
  }, []);

  return {
    profile, courses, jobs, isLoading, error, isUploading, uploadResult,
    refetch: fetchAll, uploadTranscript, updateProfile, updateJobStatus,
    updateCourseStatus, resetAllCourses, deleteCourse, addManualCourse, editCourse,
  };
}
