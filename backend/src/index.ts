import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createDb, type Env } from './db/client'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

app.get('/health', (c) => c.json({ ok: true }))

// Routes will be registered here as features are built
// e.g. import prospectsRoutes from './routes/prospects'
//      app.route('/prospects', prospectsRoutes)

export default app
