import { APP_NAME } from "@gitwork/core";
import { authIdentities, type Database, rateLimits, sessions, users, verifications } from "@gitwork/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, emailOTP } from "better-auth/plugins";
import type { EmailSender } from "./email";
import { OTP_PER_EMAIL, hitLimit } from "./limits";
import { signInEmail } from "./sign-in-email";
import { mayCreateUser } from "./signup";

export interface AuthConfig {
  database: Database;
  secret: string;
  baseURL: string;
  email: EmailSender;
  /** GitHub App OAuth credentials for linking GitHub accounts. Omit to disable linking. */
  github?: { clientId: string; clientSecret: string };
  /**
   * The one request header that carries the real client IP, set by infrastructure the client
   * cannot bypass: `cf-connecting-ip` on Workers, or a reverse proxy's header on Node. Omit when
   * nothing sets one; per-IP limits then switch off (a spoofable or shared key is worse than none)
   * and the per-email limit still applies.
   */
  trustedIpHeader?: string;
  /** Lowercase emails from INSTANCE_ADMIN_EMAILS. They may always sign up. */
  instanceAdminEmails?: string[];
}

/**
 * Better Auth owns identity only (decision 017). Created per request: D1 bindings are per request.
 * Sign-in is a 6-digit email code; the same email carries a link that embeds the code.
 */
export function createAuth(config: AuthConfig) {
  const { db } = config.database;
  return betterAuth({
    appName: APP_NAME,
    secret: config.secret,
    baseURL: config.baseURL,
    database: drizzleAdapter(db as never, {
      provider: "sqlite",
      schema: {
        users,
        sessions,
        auth_identities: authIdentities,
        verifications,
        rate_limits: rateLimits,
      },
    }),
    user: { modelName: "users" },
    session: { modelName: "sessions" },
    verification: { modelName: "verifications" },
    account: {
      modelName: "auth_identities",
      // GitHub tokens can write to client repos.
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, allowDifferentEmails: true },
    },
    // In the database: Worker isolates do not share memory, so in-memory limits do not hold.
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rate_limits",
      window: 60,
      max: 100,
      customRules: {
        "/email-otp/send-verification-otp": { window: 300, max: 5 },
        "/sign-in/email-otp": { window: 300, max: 10 },
      },
    },
    advanced: {
      ipAddress: config.trustedIpHeader
        ? { ipAddressHeaders: [config.trustedIpHeader] }
        : { disableIpTracking: true },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/email-otp/send-verification-otp") return;
        const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "").toLowerCase();
        if (email && !(await hitLimit(db, `otp-email:${email}`, OTP_PER_EMAIL))) {
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many codes requested. Try again in a few minutes." });
        }
      }),
    },
    socialProviders: config.github
      ? {
          github: {
            clientId: config.github.clientId,
            clientSecret: config.github.clientSecret,
            // Link only. GitHub sign-up would bypass the sign-up policy.
            disableSignUp: true,
          },
        }
      : {},
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = user.email.toLowerCase();
            if (!(await mayCreateUser(db, email, new Date(), config.instanceAdminEmails))) {
              throw new APIError("FORBIDDEN", { message: "Sign-ups are invite-only on this instance." });
            }
            return { data: { ...user, email } };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") return;
          await config.email.send(signInEmail({ baseURL: config.baseURL, email, code: otp }));
        },
      }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
