import { Link } from "react-router";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <EmptyState icon={Compass} title="Page not found" description="The page you are looking for doesn't exist or has moved." className="mt-10">
      <Button asChild>
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </EmptyState>
  );
}
