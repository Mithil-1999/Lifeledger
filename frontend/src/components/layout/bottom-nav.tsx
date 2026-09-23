import { NavLink } from "react-router";
import { Menu } from "lucide-react";
import { MOBILE_PRIMARY_PATHS, findNavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";

const itemClass =
  "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors";

/** Thumb-friendly bottom tab bar for phones (below md). "More" opens the full drawer. */
export function BottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const items = MOBILE_PRIMARY_PATHS.map(findNavItem).filter((item) => item !== undefined);

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(itemClass, isActive ? "text-primary" : "text-muted-foreground hover:text-foreground")
            }
          >
            <Icon className="size-5" aria-hidden />
            {item.title}
          </NavLink>
        );
      })}
      <button
        type="button"
        onClick={onOpenMenu}
        className={cn(itemClass, "text-muted-foreground hover:text-foreground")}
      >
        <Menu className="size-5" aria-hidden />
        More
      </button>
    </nav>
  );
}
