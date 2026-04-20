interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start mb-8">
      {/* Icon container */}
      {icon && (
        <div className="w-10 h-10 rounded-xl bg-indigo-50/50 border border-indigo-100 flex items-center justify-center shrink-0 me-4">
          {icon}
        </div>
      )}

      {/* Title block */}
      <div>
        <h1 className="text-2xl font-bold text-[#37352F] leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-[#787774] mt-0.5">{subtitle}</p>}
      </div>

      {/* Actions slot */}
      {actions && (
        <div className="ml-auto flex items-center gap-3">
          {actions}
        </div>
      )}
    </div>
  );
}
