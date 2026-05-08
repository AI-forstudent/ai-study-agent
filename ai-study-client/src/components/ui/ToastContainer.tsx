import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { dismissToast, useToasts, type Toast } from '../../hooks/useToast';

const KIND_STYLES: Record<Toast['kind'], { bg: string; border: string; iconBg: string; icon: typeof Info }> = {
  info: {
    bg:      'bg-white',
    border:  'border-[#E8E8E6]',
    iconBg:  'bg-indigo-50 border-indigo-100 text-indigo-600',
    icon:    Info,
  },
  success: {
    bg:      'bg-white',
    border:  'border-emerald-200',
    iconBg:  'bg-emerald-50 border-emerald-100 text-emerald-600',
    icon:    CheckCircle2,
  },
  error: {
    bg:      'bg-white',
    border:  'border-red-200',
    iconBg:  'bg-red-50 border-red-100 text-red-600',
    icon:    AlertCircle,
  },
};

/**
 * Renders the global toast queue (top-right, stacked, 4 s auto-dismiss).
 * Mount once near the app root; toasts come from `showToast()` which is
 * callable from anywhere.
 */
export default function ToastContainer() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-5 end-5 z-[400] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(t => {
        const style = KIND_STYLES[t.kind];
        const Icon  = style.icon;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 p-3 ${style.bg} border ${style.border} rounded-xl shadow-lg animate-in fade-in slide-in-from-top-2 duration-200`}
          >
            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${style.iconBg}`}>
              <Icon className="w-4 h-4" />
            </div>
            <p className="text-sm text-[#37352F] leading-relaxed flex-1 min-w-0 break-words">
              {t.message}
            </p>
            <button
              onClick={() => dismissToast(t.id)}
              className="p-1 rounded-md text-[#C4C4C4] hover:text-[#787774] hover:bg-[#F7F7F5] transition-colors duration-150 shrink-0"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
