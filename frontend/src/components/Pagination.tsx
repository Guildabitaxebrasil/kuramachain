interface Props { currentPage: number; totalPages: number; onPageChange: (page: number) => void; }

/** Gera a lista de páginas visíveis (janela ao redor da página atual). */
function pageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('…');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('…');
  pages.push(total);
  return pages;
}

export default function Pagination({ currentPage, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  const baseBtn =
    'px-3 py-1.5 text-sm rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="flex items-center justify-center gap-2 mt-6 flex-wrap">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className={`${baseBtn} bg-kur-bg-card/80 border-kur-border text-kur-text-muted hover:text-kur-text hover:border-kur-accent hover:shadow-glow-sm`}
      >
        <span className="hidden sm:inline">← Anterior</span>
        <span className="sm:hidden">←</span>
      </button>

      {/* Números das páginas (só em telas maiores) */}
      <div className="hidden sm:flex items-center gap-1">
        {pageWindow(currentPage, totalPages).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="px-2 text-kur-text-muted">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              aria-current={p === currentPage ? 'page' : undefined}
              className={`min-w-[2.25rem] px-2.5 py-1.5 text-sm rounded-xl border transition-all ${
                p === currentPage
                  ? 'bg-kur-gradient text-white border-transparent shadow-glow-sm font-semibold'
                  : 'bg-kur-bg-card/80 border-kur-border text-kur-text-muted hover:text-kur-text hover:border-kur-accent'
              }`}
            >
              {p}
            </button>
          ),
        )}
      </div>

      <span className="sm:hidden text-sm text-kur-text-muted px-2">
        Página {currentPage} de {totalPages}
      </span>

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className={`${baseBtn} bg-kur-bg-card/80 border-kur-border text-kur-text-muted hover:text-kur-text hover:border-kur-accent hover:shadow-glow-sm`}
      >
        <span className="hidden sm:inline">Próxima →</span>
        <span className="sm:hidden">→</span>
      </button>
    </div>
  );
}
