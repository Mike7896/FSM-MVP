import { z } from "zod";

/**
 * Auth input.
 *
 * The messages are written to be read by a contractor mid-task, not by a
 * developer — Content Design's error rule applies to validation too: say what
 * is wrong and what to do, never just name the constraint.
 */

export const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  next: z.string().max(500).optional(),
  fullName: z
    .string()
    .trim()
    .max(120, "That's longer than we can store.")
    .optional(),
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "At least 8 characters.")
    .max(72, "Passwords cap at 72 characters."),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const passwordResetSchema = z.object({
  email: z.email("Enter a valid email address."),
});

export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

/**
 * A new password, typed twice — shared by every way of setting one, so the
 * rules cannot drift between the Account form and the reset link.
 */
const newPassword = {
  password: z
    .string()
    .min(8, "At least 8 characters.")
    .max(72, "Passwords cap at 72 characters."),
  confirmPassword: z.string().min(1, "Type the new password again."),
};

const confirmMatches = (values: { password: string; confirmPassword: string }) =>
  values.password === values.confirmPassword;

const mismatch = {
  message: "Those two don't match.",
  path: ["confirmPassword"],
};

/**
 * Changing the password from Account.
 *
 * **The current password is asked for, and Supabase does not require it.**
 * `updateUser` will change a password on the strength of the session alone,
 * which means an unlocked laptop is a taken account. Re-authenticating first
 * costs one field and closes that.
 *
 * The confirmation field is not belt-and-braces either: a typo in a password
 * nobody can read locks the contractor out of the product that holds their
 * money.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    ...newPassword,
  })
  .refine(confirmMatches, mismatch);

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ChangePasswordFormValues = z.input<typeof changePasswordSchema>;

/**
 * Setting a password from a reset link. No current password — the link in the
 * inbox is the proof, and a contractor who forgot it has nothing to type.
 */
export const resetPasswordSchema = z
  .object(newPassword)
  .refine(confirmMatches, mismatch);

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * The body of `PUT /api/v1/auth/password`, which takes either proof: the
 * current password, or nothing extra when the session came from an email link
 * minutes ago. The two forms above are the strict halves of this one; the
 * route decides which proof it was given.
 */
export const setPasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Enter your current password.")
      .optional(),
    ...newPassword,
  })
  .refine(confirmMatches, mismatch);

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

/**
 * The one line screen 3 asks for.
 *
 * Deliberately permissive — the promise is "however you'd say it out loud",
 * so the only real rule is that there is something to name the quote by.
 */
export const seedSchema = z.object({
  seed: z
    .string()
    .trim()
    .min(3, "A few more words — who it's for and what the job is.")
    .max(300, "One line is enough — you can add detail in the editor."),
});

export type SeedInput = z.infer<typeof seedSchema>;

/** The profile gap on screen 6, one field at a time. */
export const businessNameSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(1, "Your customer sees this at the top of the quote.")
    .max(120, "That's longer than we can store."),
});

export const licenseNumberSchema = z.object({
  license: z
    .string()
    .trim()
    .min(1, "Enter the number as it appears on the license.")
    .max(60),
});

export const phoneSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(7, "That doesn't look like a phone number.")
    .max(40),
});
