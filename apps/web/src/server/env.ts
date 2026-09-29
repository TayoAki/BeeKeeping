import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).optional(),
    BEEKEEPING_OUTBOX_DIR: z.string().min(1).default("/tmp/beekeeping-outbox"),
  })
  .refine((env) => env.NODE_ENV !== "production" || env.RESEND_API_KEY, {
    message: "Production sends real email, so it needs RESEND_API_KEY.",
    path: ["RESEND_API_KEY"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.EMAIL_FROM, {
    message:
      "Production sends from a domain Resend has verified, so it needs EMAIL_FROM.",
    path: ["EMAIL_FROM"],
  })
  .transform((env) => ({
    ...env,
    EMAIL_FROM: env.EMAIL_FROM ?? "BeeKeeping <no-reply@beekeeping.test>",
  }));

export type ServerEnv = z.infer<typeof schema>;

/**
 * Reads the server's settings. A problem names the variable and never its
 * value, since several of them are secrets.
 */
export function readServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(
      `BeeKeeping's settings are incomplete:\n${problems.join("\n")}`,
    );
  }
  return parsed.data;
}
