import { Sidebar } from './Sidebar';

export function Layout({ children }: { children: React.ReactNode }) {
  // dvh, not vh: iOS resolves vh against the toolbar-retracted viewport, so
  // min-h-screen leaves ~100px of phantom scroll on every page.
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar />
      {/*
        min-w-0 is load-bearing: a flex child defaults to min-width:auto, so any
        wide descendant (a table, a long unbroken string) forces this column
        wider than the viewport and the whole page scrolls sideways.

        No overflow-y here either — the sidebar is `sticky`, so the document
        itself should be the only vertical scroller. A second scroll container
        nested inside the page is what produces the "dead scroll" on iOS, where
        momentum gets captured by the wrong element.
      */}
      <main className="flex-1 min-w-0 pt-14 md:pt-0">
        <div className="mx-auto w-full max-w-6xl xl:max-w-7xl p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
