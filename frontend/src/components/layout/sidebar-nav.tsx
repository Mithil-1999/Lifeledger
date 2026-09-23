import { NavLink } from "react-router";
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from "@/config/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

function SidebarLink({ item, collapsed, onNavigate }: { item: NavItem } & SidebarNavProps) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-sidebar-foreground hover:bg-secondary hover:text-foreground",
        )
      }
    >
      <Icon className="size-4.5 shrink-0" aria-hidden />
      {collapsed ? <span className="sr-only">{item.title}</span> : <span className="truncate">{item.title}</span>}
    </NavLink>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.title}</TooltipContent>
    </Tooltip>
  );
}

export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  return (
    <nav aria-label="Main navigation" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            {collapsed ? (
              <div className="mx-auto mb-1 h-px w-6 bg-sidebar-border" aria-hidden />
            ) : (
              <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {group.label}
              </p>
            )}
            {group.items.map((item) => (
              <SidebarLink key={item.path} item={item} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-sidebar-border px-3 py-2">
        <SidebarLink item={SETTINGS_ITEM} collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
