import * as React from "react";
import { Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api";
import { useRevealPassword } from "./api";
import { CLIPBOARD_CLEAR_SECONDS, REVEAL_SECONDS } from "./constants";

const MASK = "••••••••••••";

/** Best-effort clipboard clearing: only if it still holds our secret (and the browser lets us check). */
async function clearClipboardIfUnchanged(secret: string) {
  try {
    const current = await navigator.clipboard.readText();
    if (current === secret) await navigator.clipboard.writeText("");
  } catch {
    // Reading the clipboard needs permission; if denied we leave it alone rather than
    // overwrite something else the user copied since.
  }
}

/**
 * A single entry's password: masked by default, shown only after an explicit click,
 * and hidden again automatically after REVEAL_SECONDS, when the tab is hidden, or on unmount.
 * The plaintext lives only in this component's state (never in the query cache).
 */
export function SecretField({ entryId, label }: { entryId: string; label: string }) {
  const reveal = useRevealPassword();
  const [secret, setSecret] = React.useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = React.useState(0);

  const hide = React.useCallback(() => {
    setSecret(null);
    setSecondsLeft(0);
  }, []);

  // Countdown, then hide.
  React.useEffect(() => {
    if (secret === null) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setSecret(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secret]);

  // Hide when the page goes to the background.
  React.useEffect(() => {
    const onVisibility = () => document.visibilityState === "hidden" && hide();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [hide]);

  const show = () =>
    reveal.mutate(
      { id: entryId, purpose: "reveal" },
      {
        onSuccess: ({ password }) => {
          setSecret(password);
          setSecondsLeft(REVEAL_SECONDS);
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );

  const copy = () =>
    reveal.mutate(
      { id: entryId, purpose: "copy" },
      {
        onSuccess: async ({ password }) => {
          try {
            await navigator.clipboard.writeText(password);
            toast.success(`Password copied. It will be cleared from the clipboard in ${CLIPBOARD_CLEAR_SECONDS}s where your browser allows.`);
            window.setTimeout(() => void clearClipboardIfUnchanged(password), CLIPBOARD_CLEAR_SECONDS * 1000);
          } catch {
            toast.error("Couldn't access the clipboard. Reveal the password and copy it manually.");
          }
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );

  return (
    <div className="flex min-w-0 items-center gap-1">
      <code
        className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-sm"
        aria-label={secret ? `${label} password (visible)` : `${label} password (hidden)`}
        aria-live="polite"
      >
        {secret ?? MASK}
      </code>
      {secret !== null && <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground" aria-label={`Hides in ${secondsLeft} seconds`}>{secondsLeft}s</span>}
      {secret === null ? (
        <Button variant="ghost" size="icon" onClick={show} disabled={reveal.isPending} aria-label={`Reveal ${label} password`}>
          {reveal.isPending ? <Loader2 className="animate-spin" /> : <Eye />}
        </Button>
      ) : (
        <Button variant="ghost" size="icon" onClick={hide} aria-label={`Hide ${label} password`}>
          <EyeOff />
        </Button>
      )}
      <Button variant="ghost" size="icon" onClick={copy} disabled={reveal.isPending} aria-label={`Copy ${label} password`}>
        <Copy />
      </Button>
    </div>
  );
}
