import { Link, useLocation, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { FormField } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard } from "@/features/auth/auth-layout";
import { safeRedirectPath } from "@/features/auth/redirect";
import { loginSchema, type LoginValues } from "@/features/auth/schemas";
import { useAuthConfig, useLogin } from "@/features/auth/use-auth";
import { getErrorMessage } from "@/lib/api";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const loginMutation = useLogin();
  const { data: config } = useAuthConfig();
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "", remember_me: false },
  });

  const onSubmit = handleSubmit((values) =>
    loginMutation.mutate(values, {
      onSuccess: () => {
        const from = (location.state as { from?: unknown } | null)?.from;
        navigate(safeRedirectPath(from), { replace: true });
      },
      onError: () => resetField("password"),
    }),
  );

  return (
    <AuthCard
      title="Sign in to LifeVault"
      description="Welcome back. Enter your details to continue."
      footer={
        config?.registration_enabled !== false && (
          <>
            New here?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </>
        )
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {loginMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <span>{getErrorMessage(loginMutation.error)}</span>
          </Alert>
        )}
        <FormField id="identifier" label="Email or username" error={errors.identifier?.message}>
          {(aria) => <Input {...aria} autoComplete="username" autoFocus {...register("identifier")} />}
        </FormField>
        <FormField
          id="password"
          label="Password"
          error={errors.password?.message}
          labelAction={
            <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          }
        >
          {(aria) => <PasswordInput {...aria} autoComplete="current-password" {...register("password")} />}
        </FormField>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4 rounded border-input accent-primary" {...register("remember_me")} />
          Keep me signed in for 30 days
        </label>
        <Button type="submit" size="lg" disabled={loginMutation.isPending} className="mt-1">
          {loginMutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
