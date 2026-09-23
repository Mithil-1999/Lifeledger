import { cn } from "@/lib/utils";
import { passwordScore } from "./schemas";

const LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];
const COLORS = ["bg-destructive", "bg-destructive", "bg-warning", "bg-success", "bg-success"];

export function PasswordStrength({ password }: { password: string }) {
  const score = passwordScore(password);
  if (!password) return null;
  return (
    <div className="grid gap-1" aria-live="polite">
      <div className="grid grid-cols-4 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={cn("h-1 rounded-full bg-muted", score >= step && COLORS[score])} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">Strength: {LABELS[score]}</span>
    </div>
  );
}
