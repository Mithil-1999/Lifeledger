import { Link } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { FormField } from "@/components/forms/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard } from "@/features/auth/auth-layout";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/features/auth/schemas";
import { useForgotPassword } from "@/features/auth/use-auth";
import { getErrorMessage } from "@/lib/api";

export function ForgotPasswordPage() {
  const mutation = useForgotPassword();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  const backToLogin = (
    <Link to="/login" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
      <ArrowLeft className="size-3.5" aria-hidden /> Back to sign in
    </Link>
  );

  if (mutation.isSuccess) {
    return (
      <AuthCard title="Check your email" footer={backToLogin}>
        <Alert variant="success">
          <MailCheck aria-hidden />
          <span>
            If an account exists for that email, we've sent a link to reset your password. The link expires in 30
            minutes.
          </span>
        </Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter your account email and we'll send you a reset link."
      footer={backToLogin}
    >
      <form onSubmit={handleSubmit(({ email }) => mutation.mutate(email))} noValidate className="grid gap-4">
        {mutation.isError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <span>{getErrorMessage(mutation.error)}</span>
          </Alert>
        )}
        <FormField id="email" label="Email" error={errors.email?.message}>
          {(aria) => <Input {...aria} type="email" autoComplete="email" autoFocus {...register("email")} />}
        </FormField>
        <Button type="submit" size="lg" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
