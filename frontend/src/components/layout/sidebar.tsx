import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/** Persistent sidebar for large screens (lg and up). Smaller screens use the drawer + bottom bar. */
export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex",
        collapsed ? "w-[4.5rem]" : "w-64",
      )}
    >
      <div className={cn("flex h-16 items-center border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
        <Brand collapsed={collapsed} />
      </div>
      <SidebarNav collapsed={collapsed} />
      <div className={cn("border-t border-sidebar-border p-3", collapsed && "flex justify-center")}>
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className={cn(!collapsed && "w-full justify-start text-muted-foreground")}
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          {!collapsed && "Collapse"}
        </Button>
      </div>
    </aside>
  );
}
