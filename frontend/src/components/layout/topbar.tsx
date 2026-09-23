import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ApiStatusIndicator } from "@/features/system/api-status-indicator";
import { Brand } from "./brand";
import { UserMenu } from "./user-menu";

interface TopbarProps {
  title: string;
  onOpenMenu: () => void;
}

export function Topbar({ title, onOpenMenu }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
      <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" onClick={onOpenMenu} aria-label="Open navigation menu">
        <Menu />
      </Button>
      <Brand collapsed className="md:hidden" />
      <p className="truncate text-sm font-semibold text-foreground md:text-base" aria-hidden>
        {title}
      </p>
      <div className="ml-auto flex items-center gap-1">
        <ApiStatusIndicator />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
