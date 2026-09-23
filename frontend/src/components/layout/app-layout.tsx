import * as React from "react";
import { Outlet, useLocation } from "react-router";
import { pageTitle } from "@/config/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BottomNav } from "./bottom-nav";
import { MobileDrawer } from "./mobile-drawer";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

const COLLAPSE_KEY = "lifevault-sidebar-collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const [collapsed, setCollapsed] = React.useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const { pathname } = useLocation();
  const title = pageTitle(pathname);

  const toggleCollapsed = () =>
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      } catch {
        // Non-fatal.
      }
      return !value;
    });

  React.useEffect(() => {
    document.title = title === "LifeVault" ? "LifeVault" : `${title} · LifeVault`;
  }, [title]);

  return (
    <TooltipProvider delayDuration={200}>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <MobileDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <div className={cn("flex min-h-dvh flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[4.5rem]" : "lg:pl-64")}>
        <Topbar title={title} onOpenMenu={() => setDrawerOpen(true)} />
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 pb-24 pt-6 outline-none sm:px-6 md:pb-10 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav onOpenMenu={() => setDrawerOpen(true)} />
    </TooltipProvider>
  );
}
