import * as React from "react";
import { Link, useNavigate } from "react-router";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/auth-layout";
import { PasswordStrength } from "@/features/auth/password-strength";
import { resetPasswordSchema, type ResetPasswordValues } from "@/features/auth/schemas";
import { useResetPassword } from "@/features/auth/use-auth";
import { getErrorMessage } from "@/lib/api";

/**
 * Reads the token from the URL fragment (`#token=...`), which browsers never send to
 * servers, then immediately strips it from the address bar and history.
 */
function useResetTokenFromFragment() {
  const [token] = React.useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  React.useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, []);
  return token;
}

export function ResetPasswordPage() {
  const token = useResetTokenFromFragment();
  const navigate = useNavigate();
  const mutation = useResetPassword();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onTouched",
    defaultValues: { new_password: "", confirm_new_password: "" },
  });
  const password = useWatch({ control, name: "new_password" });

  if (!token) {
    return (
      <AuthCard
        title="Reset link missing"
        description="This page needs the link from your password reset email."
        footer={
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
            Request a new reset link
          </Link>
        }
      >
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <span>Open the full link from the email, or request a new one.</span>
        </Alert>
      </AuthCard>
    );
  }

  const onSubmit = handleSubmit((values) =>
    mutation.mutate(
      { token, ...values },
      {
        onSuccess: () => {
          toast.success("Password updated. Please sign in with your new password.");
          navigate("/login", { replace: true });
        },
      },
    ),
  );

  return (
    <AuthCard
      title="Choose a new password"
      description="For your security, you'll be signed out of all devices."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {mutation.isError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <span>
              {getErrorMessage(mutation.error)}{" "}
              <Link to="/forgot-password" className="font-medium underline">
                Request a new link
              </Link>
            </span>
          </Alert>
        )}
        <FormField
          id="new_password"
          label="New password"
          error={errors.new_password?.message}
          hint="At least 12 characters, mixing three of: lowercase, uppercase, numbers, symbols."
        >
          {(aria) => <PasswordInput {...aria} autoComplete="new-password" autoFocus {...register("new_password")} />}
        </FormField>
        <PasswordStrength password={password} />
        <FormField id="confirm_new_password" label="Confirm new password" error={errors.confirm_new_password?.message}>
          {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...register("confirm_new_password")} />}
        </FormField>
        <Button type="submit" size="lg" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
