interface Props { size?: 'sm' | 'md' | 'lg'; text?: string; }
export default function LoadingSpinner({ size = 'md', text = 'Carregando...' }: Props) {
  const sizeMap = { sm: 'h-4 w-4 border-2', md: 'h-8 w-8 border-2', lg: 'h-12 w-12 border-[3px]' };
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className={`${sizeMap[size]} animate-spin rounded-full border-kur-border border-t-kur-accent border-r-kur-violet shadow-glow-sm`} />
      {text && <p className="mt-3 text-sm text-kur-text-muted">{text}</p>}
    </div>
  );
}
