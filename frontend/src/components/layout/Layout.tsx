import { Sidebar } from './Sidebar';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#F5F5F5] dark:bg-background">
      <Sidebar />
      <main className="flex-1 pt-14 md:pt-0 min-h-screen overflow-y-auto overflow-x-hidden">
        <div className="max-w-6xl xl:max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
