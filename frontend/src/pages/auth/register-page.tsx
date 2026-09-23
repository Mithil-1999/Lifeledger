import { Link, useNavigate } from "react-router";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { FormField } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard } from "@/features/auth/auth-layout";
import { PasswordStrength } from "@/features/auth/password-strength";
import { registerSchema, type RegisterValues } from "@/features/auth/schemas";
import { useAuthConfig, useRegister } from "@/features/auth/use-auth";
import { getErrorMessage, getFieldError } from "@/lib/api";

export function RegisterPage() {
  const navigate = useNavigate();
  const registerMutation = useRegister();
  const { data: config } = useAuthConfig();
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: "onTouched",
    defaultValues: { name: "", username: "", email: "", password: "", confirm_password: "" },
  });
  const password = useWatch({ control, name: "password" });

  const onSubmit = handleSubmit((values) =>
    registerMutation.mutate(values, {
      onSuccess: (user) => {
        toast.success(`Welcome to LifeVault, ${user.name.split(" ")[0]}!`);
        navigate("/dashboard", { replace: true });
      },
      onError: (error) => {
        const fieldError = getFieldError(error);
        if (fieldError && (fieldError.field === "email" || fieldError.field === "username")) {
          setError(fieldError.field, { message: fieldError.message }, { shouldFocus: true });
        }
      },
    }),
  );

  if (config?.registration_enabled === false) {
    return (
      <EmptyState icon={Lock} title="Registration is closed" description="This LifeVault is private. Sign in with your existing account.">
        <Button asChild>
          <Link to="/login">Go to sign in</Link>
        </Button>
      </EmptyState>
    );
  }

  const formError = registerMutation.isError && !getFieldError(registerMutation.error);

  return (
    <AuthCard
      title="Create your account"
      description="Set up your private LifeVault."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {formError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <span>{getErrorMessage(registerMutation.error)}</span>
          </Alert>
        )}
        <FormField id="name" label="Full name" error={errors.name?.message}>
          {(aria) => <Input {...aria} autoComplete="name" autoFocus {...register("name")} />}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="username" label="Username" error={errors.username?.message}>
            {(aria) => <Input {...aria} autoComplete="username" autoCapitalize="none" {...register("username")} />}
          </FormField>
          <FormField id="email" label="Email" error={errors.email?.message}>
            {(aria) => <Input {...aria} type="email" autoComplete="email" {...register("email")} />}
          </FormField>
        </div>
        <FormField
          id="password"
          label="Password"
          error={errors.password?.message}
          hint="At least 12 characters, mixing three of: lowercase, uppercase, numbers, symbols."
        >
          {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...register("password")} />}
        </FormField>
        <PasswordStrength password={password} />
        <FormField id="confirm_password" label="Confirm password" error={errors.confirm_password?.message}>
          {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...register("confirm_password")} />}
        </FormField>
        <Button type="submit" size="lg" disabled={registerMutation.isPending} className="mt-1">
          {registerMutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
