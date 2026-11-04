interface Props { title: string; value: string | number; subtitle?: string; icon?: string; accent?: string; }
export default function StatCard({ title, value, subtitle, icon, accent = 'text-kur-accent' }: Props) {
  return (
    <div className="group relative overflow-hidden bg-kur-bg-card/80 border border-kur-border rounded-2xl p-4 sm:p-5 backdrop-blur-sm shadow-card hover:border-kur-accent/40 hover:shadow-glow-sm transition-all duration-300">
      <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-kur-accent/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-kur-text-muted uppercase tracking-wider">{title}</p>
          <p className={`text-xl sm:text-2xl font-bold mt-1 font-mono ${accent}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
          {subtitle && <p className="text-xs text-kur-text-muted mt-1">{subtitle}</p>}
        </div>
        {icon && (
          <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-kur-bg-hover/60 ring-1 ring-kur-border text-xl shrink-0 transition-transform group-hover:scale-110">
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}
