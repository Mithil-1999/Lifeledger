/**
 * Client-side validation. Mirrors the backend rules for fast feedback; the API remains
 * the source of truth and re-validates everything.
 */
import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const CHARACTER_CLASSES = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/];

export function characterClassCount(password: string) {
  return CHARACTER_CLASSES.filter((pattern) => pattern.test(password)).length;
}

/** Problems with a new password (empty = acceptable). `personal` = name/username/email parts. */
export function passwordProblems(password: string, personal: string[] = []): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (password.length > PASSWORD_MAX_LENGTH) problems.push(`Use at most ${PASSWORD_MAX_LENGTH} characters.`);
  if (characterClassCount(password) < 3) problems.push("Mix at least three of: lowercase, uppercase, numbers, symbols.");
  if (new Set(password).size <= 3) problems.push("Avoid repeated or predictable characters.");
  const lowered = password.toLowerCase();
  if (personal.some((part) => part.length >= 3 && lowered.includes(part.toLowerCase()))) {
    problems.push("Don't include your name, username or email.");
  }
  return problems;
}

/** 0–4 score for the strength meter. */
export function passwordScore(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score++;
  if (password.length >= 16) score++;
  if (characterClassCount(password) >= 3) score++;
  if (characterClassCount(password) === 4 && password.length >= 14) score++;
  return Math.min(score, 4);
}

const newPassword = z.string().max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

function personalParts(values: { name?: string; username?: string; email?: string }) {
  return [values.username ?? "", (values.email ?? "").split("@")[0], ...(values.name ?? "").split(/\s+/)];
}

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email or username.").max(254),
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX_LENGTH),
  remember_me: z.boolean(),
});

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name.").max(100, "Use at most 100 characters."),
    username: z
      .string()
      .trim()
      .min(3, "Use at least 3 characters.")
      .max(32, "Use at most 32 characters.")
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/, "Use letters, numbers, and . _ - (not at the start or end)."),
    email: z.string().trim().max(254).pipe(z.email("Enter a valid email address.")),
    password: newPassword,
    confirm_password: z.string(),
  })
  .superRefine((values, ctx) => {
    for (const message of passwordProblems(values.password, personalParts(values))) {
      ctx.addIssue({ code: "custom", path: ["password"], message });
      break; // Show one actionable problem at a time.
    }
    if (values.password !== values.confirm_password) {
      ctx.addIssue({ code: "custom", path: ["confirm_password"], message: "Passwords do not match." });
    }
  });

export const forgotPasswordSchema = z.object({
  email: z.string().trim().max(254).pipe(z.email("Enter a valid email address.")),
});

export const resetPasswordSchema = z
  .object({ new_password: newPassword, confirm_new_password: z.string() })
  .superRefine((values, ctx) => {
    const [problem] = passwordProblems(values.new_password);
    if (problem) ctx.addIssue({ code: "custom", path: ["new_password"], message: problem });
    if (values.new_password !== values.confirm_new_password) {
      ctx.addIssue({ code: "custom", path: ["confirm_new_password"], message: "Passwords do not match." });
    }
  });

export function changePasswordSchema(personal: string[]) {
  return z
    .object({
      current_password: z.string().min(1, "Enter your current password.").max(PASSWORD_MAX_LENGTH),
      new_password: newPassword,
      confirm_new_password: z.string(),
    })
    .superRefine((values, ctx) => {
      const [problem] = passwordProblems(values.new_password, personal);
      if (problem) ctx.addIssue({ code: "custom", path: ["new_password"], message: problem });
      if (values.new_password && values.new_password === values.current_password) {
        ctx.addIssue({ code: "custom", path: ["new_password"], message: "Choose a password different from your current one." });
      }
      if (values.new_password !== values.confirm_new_password) {
        ctx.addIssue({ code: "custom", path: ["confirm_new_password"], message: "Passwords do not match." });
      }
    });
}

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordValues = z.infer<ReturnType<typeof changePasswordSchema>>;
