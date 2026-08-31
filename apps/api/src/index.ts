import { Hono } from "hono";
import type { Env } from "./types";

// Walking skeleton: no routes yet, so Hono answers every path with 404.
// Routing, middleware and error envelopes arrive in prompt 03.
const app = new Hono<{ Bindings: Env }>();

export default app;
