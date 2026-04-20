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
    </div>
  );
}
