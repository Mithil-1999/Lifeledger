import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { NAV_GROUPS, findNavItem } from "@/config/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SystemStatusCard } from "@/features/system/system-status-card";

const MODULES = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.path !== "/dashboard");

export function DashboardPage() {
  const dashboard = findNavItem("/dashboard")!;

  return (
    <>
      <PageHeader title="Dashboard" description={dashboard.description} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Welcome to LifeVault</CardTitle>
            <CardDescription>
              The foundation is ready. Financial summaries, tasks and reminders will appear here once their modules are
              built. Only real data you record will ever be shown.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="secondary">Default currency: NPR</Badge>
            <Badge variant="secondary">Private, single-user</Badge>
            <Badge variant="outline">Dashboard widgets · Phase {dashboard.phase}</Badge>
          </CardContent>
        </Card>
        <SystemStatusCard />
      </div>

      <section aria-labelledby="modules-heading" className="mt-8">
        <h2 id="modules-heading" className="mb-3 text-sm font-semibold text-muted-foreground">
          Modules
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MODULES.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className="group flex min-w-0 items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {item.title}
                    <span className="text-[11px] font-normal text-muted-foreground">Phase {item.phase}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}
