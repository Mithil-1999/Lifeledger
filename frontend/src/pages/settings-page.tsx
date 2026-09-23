import { Link } from "react-router";
import { ChevronRight, KeyRound } from "lucide-react";
import { ModulePlaceholder } from "@/components/common/module-placeholder";

export function SettingsPage() {
  return (
    <>
      <ModulePlaceholder path="/settings" />
      <section aria-labelledby="security-heading" className="mt-6">
        <h2 id="security-heading" className="mb-3 text-sm font-semibold text-muted-foreground">
          Available now
        </h2>
        <Link
          to="/settings/password"
          className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <KeyRound className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">Change password</span>
            <span className="block text-xs text-muted-foreground">Update your sign-in password and sign out other devices.</span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      </section>
    </>
  );
}
