import * as React from "react";
import { Link } from "react-router";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { FormField } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordStrength } from "@/features/auth/password-strength";
import { changePasswordSchema, type ChangePasswordValues } from "@/features/auth/schemas";
import { useChangePassword, useCurrentUser } from "@/features/auth/use-auth";
import { getErrorMessage } from "@/lib/api";

export function ChangePasswordPage() {
  const { data: user } = useCurrentUser();
  const mutation = useChangePassword();
  const schema = React.useMemo(
    () => changePasswordSchema([user?.username ?? "", user?.email.split("@")[0] ?? "", ...(user?.name.split(/\s+/) ?? [])]),
    [user],
  );
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { current_password: "", new_password: "", confirm_new_password: "" },
  });
  const newPassword = useWatch({ control, name: "new_password" });

  const onSubmit = handleSubmit((values) =>
    mutation.mutate(values, {
      onSuccess: (result) => {
        reset();
        toast.success(result.message);
      },
    }),
  );

  return (
    <>
      <PageHeader
        title="Change password"
        description="Update the password you use to sign in to LifeVault."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings">
              <ArrowLeft aria-hidden /> Settings
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>After changing it, all your other devices will be signed out.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-4">
              {mutation.isError && (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden />
                  <span>{getErrorMessage(mutation.error)}</span>
                </Alert>
              )}
              <FormField id="current_password" label="Current password" error={errors.current_password?.message}>
                {(aria) => <PasswordInput {...aria} autoComplete="current-password" {...register("current_password")} />}
              </FormField>
              <FormField
                id="new_password"
                label="New password"
                error={errors.new_password?.message}
                hint="At least 12 characters, mixing three of: lowercase, uppercase, numbers, symbols."
              >
                {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...register("new_password")} />}
              </FormField>
              <PasswordStrength password={newPassword} />
              <FormField id="confirm_new_password" label="Confirm new password" error={errors.confirm_new_password?.message}>
                {(aria) => <PasswordInput {...aria} autoComplete="new-password" {...register("confirm_new_password")} />}
              </FormField>
              <div>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
                  Update password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden /> Tips
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <p>Use a long passphrase that you don't use anywhere else.</p>
            <p>A password manager makes unique passwords easy.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
