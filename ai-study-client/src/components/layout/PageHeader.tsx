interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <div className="mb-5 sm:mb-8 flex flex-col gap-3 sm:flex-row sm:items-start">
      {/* Icon + title row */}
      <div className="flex items-start min-w-0">
        {icon && (
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-indigo-50/50 border border-indigo-100 flex items-center justify-center shrink-0 me-3 sm:me-4">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-[#37352F] leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-xs sm:text-sm text-[#787774] mt-0.5 line-clamp-2 sm:line-clamp-none">{subtitle}</p>}
        </div>
      </div>

      {/* Actions slot — wraps to its own row on phone, right-aligned on tablet+ */}
      {actions && (
        <div className="flex items-center gap-2 sm:gap-3 sm:ms-auto flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
}
