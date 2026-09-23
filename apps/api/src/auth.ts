import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "./db/index.js";

// The public URL of the web app. In dev the Vite server proxies /api to this API,
// so auth cookies and OAuth callbacks live on the web origin.
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
export const googleEnabled = Boolean(googleClientId && googleClientSecret);

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: googleClientId!,
          clientSecret: googleClientSecret!,
          prompt: "select_account",
        },
      }
    : {},
  account: {
    // Signing in with Google using the same email as an existing account links the two.
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  telemetry: { enabled: false },
});

export type Session = typeof auth.$Infer.Session;
