import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Env = {
  HYPERDRIVE: Hyperdrive
}

export function createDb(env: Env) {
  // In local dev wrangler resolves HYPERDRIVE.connectionString to localConnectionString
  const client = postgres(env.HYPERDRIVE.connectionString, { prepare: false })
  return drizzle(client, { schema })
}
