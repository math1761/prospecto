import type { Hono } from "hono";
import type { Env } from "../db/client";

let _app: Hono<{ Bindings: Env; Variables: any }> | null = null;

export function registerApp(app: Hono<{ Bindings: Env; Variables: any }>) {
  _app = app;
}

export function internalFetch(path: string, init: RequestInit, env: Env): Promise<Response> {
  if (!_app) throw new Error("App not registered — call registerApp() first");
  return Promise.resolve(_app.fetch(new Request(`http://internal${path}`, init), env));
}
