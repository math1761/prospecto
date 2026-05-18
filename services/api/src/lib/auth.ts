import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb, type Env } from "../db/client";
import * as schema from "../db/schema";

export function createAuth(env: Env, request?: Request) {
  const origin = request ? new URL(request.url).origin : undefined;

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL || origin,
    trustedOrigins: ["http://localhost:3000", "http://localhost:8787"],
    database: drizzleAdapter(createDb(env), {
      provider: "pg",
      schema,
    }),
    user: {
      modelName: "users",
    },
    session: {
      modelName: "sessions",
    },
    account: {
      modelName: "accounts",
    },
    emailAndPassword: {
      enabled: true,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
