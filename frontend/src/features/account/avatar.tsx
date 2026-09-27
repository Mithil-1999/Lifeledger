import type { User } from "@/features/auth/api";
import { cn } from "@/lib/utils";
import { avatarUrl } from "./api";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** Profile picture, or the user's initials when there isn't one. */
export function Avatar({ user, className }: { user: Pick<User, "name" | "has_avatar" | "avatar_updated_at">; className?: string }) {
  const url = avatarUrl(user);
  return url ? (
    <img src={url} alt="" className={cn("rounded-full object-cover", className)} />
  ) : (
    <span className={cn("flex items-center justify-center rounded-full bg-primary/15 font-semibold text-primary", className)} aria-hidden>
      {initials(user.name)}
    </span>
  );
}
