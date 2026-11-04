import type { ReactNode } from 'react';

interface Props {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  dense?: boolean;
}

/** Cartão padrão do terminal: borda suave, glass discreto, cabeçalho opcional. */
export default function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = '',
  dense = false,
}: Props) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-kur-border bg-kur-bg-card/70 shadow-card backdrop-blur-sm ${className}`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-kur-accent/40 to-transparent" />
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-kur-border/70 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="truncate text-sm font-semibold text-kur-text sm:text-base">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[11px] text-kur-text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`${dense ? 'p-3' : 'p-4 sm:p-5'} ${bodyClassName}`}>{children}</div>
    </section>
  );
}
