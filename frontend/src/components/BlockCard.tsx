import { Link } from 'react-router-dom';
import type { Block } from '../api/types';

interface Props { block: Block; }
export default function BlockCard({ block }: Props) {
  const txCount = block.transactions.length;
  return (
    <Link
      to={`/block/${block.index}`}
      className="group block relative overflow-hidden bg-kur-bg-card/80 border border-kur-border rounded-2xl p-4 sm:p-5 backdrop-blur-sm shadow-card transition-all duration-300 hover:border-kur-accent/50 hover:shadow-glow-sm hover:-translate-y-0.5"
    >
      <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-kur-gradient opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-kur-accent bg-kur-accent/10 border border-kur-accent/20 px-2 py-0.5 rounded-lg font-mono">
              #{block.index}
            </span>
            <span className="text-xs text-kur-text-muted">{new Date(block.timestamp * 1000).toLocaleString('pt-BR')}</span>
          </div>
          <p className="text-xs font-mono text-kur-text-muted truncate max-w-md">
            Hash: <span className="text-kur-text">{block.hash}</span>
          </p>
          {block.index > 0 && (
            <p className="hidden sm:block text-xs font-mono text-kur-text-muted truncate max-w-md mt-1">
              Previous: <span className="text-kur-text-muted">{block.previous_hash}</span>
            </p>
          )}
        </div>
        <div className="text-right flex flex-col items-end gap-1 shrink-0">
          <span className="text-xs bg-kur-green/10 text-kur-green border border-kur-green/20 px-2 py-0.5 rounded-full font-medium">
            {txCount} tx{txCount !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-kur-text-muted font-mono">nonce: {block.proof}</span>
        </div>
      </div>
    </Link>
  );
}
