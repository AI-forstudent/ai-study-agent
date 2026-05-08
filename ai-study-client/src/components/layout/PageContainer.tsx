interface PageContainerProps {
  children: React.ReactNode;
}

export default function PageContainer({ children }: PageContainerProps) {
  return (
    <div className="h-full overflow-y-auto bg-[#F7F7F5] flex flex-col" dir="ltr">
      <main className="flex-1 w-full max-w-6xl mx-auto px-3 py-4 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
