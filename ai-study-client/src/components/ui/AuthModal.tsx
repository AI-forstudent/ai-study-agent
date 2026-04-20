import React, { useState, useEffect } from 'react';
import { X, Mail, Lock, LogIn, UserPlus, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../../services/api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: () => void;
}

// ── Google "G" SVG logo ──────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setEmail('');
      setPassword('');
      setError(null);
      setIsLoginMode(true);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      if (isLoginMode) {
        const formData = new FormData();
        formData.append('username', email);
        formData.append('password', password);
        const res = await api.login(formData);
        localStorage.setItem('access_token', res.data.access_token);
        onLoginSuccess();
      } else {
        await api.register({ email, password });
        const formData = new FormData();
        formData.append('username', email);
        formData.append('password', password);
        const res = await api.login(formData);
        localStorage.setItem('access_token', res.data.access_token);
        onLoginSuccess();
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.guestLogin();
      localStorage.setItem('access_token', res.data.access_token);
      onLoginSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Guest login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Card — stop backdrop propagation */}
      <div
        className="bg-white rounded-2xl shadow-xl border border-[#E8E8E6] w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header row ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#E8E8E6]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-[#37352F]">
              {isLoginMode ? 'Welcome back' : 'Create an account'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] transition-colors duration-150"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-4">

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Google placeholder */}
          <button
            type="button"
            onClick={() => console.log('Google Auth coming soon')}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-[#F7F7F5] text-[#37352F] text-sm font-medium py-2.5 px-4 rounded-lg border border-[#E8E8E6] transition-colors duration-150 disabled:opacity-50"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* OR divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-[#E8E8E6]" />
            <span className="text-xs font-medium text-[#787774]">OR</span>
            <div className="flex-1 border-t border-[#E8E8E6]" />
          </div>

          {/* Email / password form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#787774] uppercase tracking-wide mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C4C4C4] pointer-events-none" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  dir="ltr"
                  className="w-full bg-white border border-[#E8E8E6] rounded-lg pl-9 pr-3 py-2.5 text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#787774] uppercase tracking-wide mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C4C4C4] pointer-events-none" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full bg-white border border-[#E8E8E6] rounded-lg pl-9 pr-3 py-2.5 text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : isLoginMode
                  ? <><LogIn className="w-4 h-4" /> Sign in</>
                  : <><UserPlus className="w-4 h-4" /> Create account</>
              }
            </button>
          </form>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="px-6 pb-5 space-y-3 border-t border-[#E8E8E6] pt-4">
          {/* Guest login */}
          <button
            type="button"
            onClick={handleGuestLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#37352F] text-sm font-medium py-2.5 rounded-lg border border-[#E8E8E6] transition-colors duration-150 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4 text-amber-500" />
            Continue as guest
          </button>

          {/* Toggle mode */}
          <p className="text-center text-xs text-[#787774]">
            {isLoginMode ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={() => { setIsLoginMode(m => !m); setError(null); }}
              className="text-indigo-600 font-medium hover:underline"
            >
              {isLoginMode ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
