import ToastContainer from '../ui/ToastContainer';

interface AppLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function AppLayout({ sidebar, children }: AppLayoutProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white font-sans">
      {sidebar}
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
      {/* Global toast queue. Renders fixed top-right; outlives view
          switches because AppLayout is the wrapper for every
          authenticated route. */}
      <ToastContainer />
    </div>
  );
}
