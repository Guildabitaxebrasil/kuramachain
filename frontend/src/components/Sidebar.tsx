import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/blocks', label: 'Explorer', icon: '🔗' },
  { to: '/transactions', label: 'Transactions', icon: '💳' },
  { to: '/network', label: 'Network', icon: '🌐' },
  { to: '/wallet', label: 'Wallet', icon: '👛' },
  { to: '/defi', label: 'DeFi', icon: '🏦' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: Props) {
  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-20 lg:hidden" onClick={onClose} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 z-30 h-screen w-64
        bg-kur-bg-card/90 backdrop-blur-xl border-r border-kur-border
        shadow-card
        transform transition-transform duration-200 ease-in-out
        lg:translate-x-0 lg:static lg:z-auto
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="relative flex items-center gap-3 px-6 h-16 border-b border-kur-border">
          <img
            src="/kurama.jpg"
            alt="Kurama Chain"
            className="w-9 h-9 rounded-xl object-cover ring-1 ring-kur-accent/40 shadow-glow-sm"
          />
          <div>
            <h1 className="text-base font-bold tracking-tight neon-text">Kurama Chain</h1>
            <p className="text-[10px] text-kur-text-muted -mt-0.5">Blockchain Explorer</p>
          </div>
          <span className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-kur-accent/60 to-transparent" />
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-1.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-kur-accent/10 text-kur-accent border border-kur-accent/30 shadow-glow-sm'
                    : 'text-kur-text-muted hover:text-kur-text hover:bg-kur-bg-hover border border-transparent'
                }`
              }
            >
              <span className="text-base transition-transform group-hover:scale-110">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Status / Version */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-kur-border">
          <div className="flex items-center justify-center gap-2 text-[10px] text-kur-text-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-kur-green animate-pulse" />
            <span>v1.0.0 — Kurama Chain</span>
          </div>
        </div>
      </aside>
    </>
  );
}
