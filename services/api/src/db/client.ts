import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { GenerateJob, SendJob } from "../lib/jobs";

export type Env = {
  HYPERDRIVE: Hyperdrive;
  CACHE: KVNamespace;
  AI_SERVICE: Fetcher;
  MAILER_SERVICE: Fetcher;
  N8N_WEBHOOK_SECRET?: string;
  API_BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  GENERATE_QUEUE: Queue<GenerateJob>;
  SEND_QUEUE: Queue<SendJob>;
};

export function createDb(env: Env) {
  // prepare: false required for Hyperdrive connection pooling compatibility
  const client = postgres(env.HYPERDRIVE.connectionString, { prepare: false });
  return drizzle(client, { schema });
}

export type DB = ReturnType<typeof createDb>;
