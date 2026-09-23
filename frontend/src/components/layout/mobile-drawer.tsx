import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";

interface MobileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Full navigation in a slide-in drawer for phones and tablets. */
export function MobileDrawer({ open, onOpenChange }: MobileDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="lg:hidden">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Browse all LifeVault sections</SheetDescription>
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <Brand />
        </div>
        <SidebarNav onNavigate={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
