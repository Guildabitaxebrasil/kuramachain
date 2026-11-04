import { useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

interface Props {
  children: React.ReactNode;
}

export default function Layout({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden text-kur-text">
      {/* Brilhos decorativos (fundo digital) */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-24 w-[36rem] h-[36rem] rounded-full bg-kur-accent/10 blur-[120px] animate-glow-pulse" />
        <div className="absolute top-1/3 -right-24 w-[32rem] h-[32rem] rounded-full bg-kur-violet/10 blur-[120px] animate-glow-pulse" />
      </div>

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="animate-fade-up">{children}</div>
        </main>
      </div>
    </div>
  );
}
