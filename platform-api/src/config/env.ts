import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.string().min(1),
    DB_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
    FIREBASE_PROJECT_ID: z.string().min(1),
    RAZORPAY_KEY_ID: z.string().min(1).optional(),
    RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional()
  })
  .superRefine((value, ctx) => {
    const razorpayValues = [
      value.RAZORPAY_KEY_ID,
      value.RAZORPAY_KEY_SECRET,
      value.RAZORPAY_WEBHOOK_SECRET
    ];
    const configured = razorpayValues.filter((entry) => entry !== undefined).length;
    if (configured !== 0 && configured !== razorpayValues.length) {
      ctx.addIssue({
        code: "custom",
        message:
          "RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must be configured together",
        path: ["RAZORPAY_KEY_ID"]
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid application configuration: ${details}`);
  }
  return parsed.data;
}
