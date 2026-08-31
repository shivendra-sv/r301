import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { attachTag, insertLink, upsertTag } from "../db/queries";
import { ApiError } from "../errors";
import { putRedirect, redirectEntryFor } from "../kv/redirects-cache";
import { methodNotAllowed } from "../middleware/errors";
import { createLinkSchema } from "../schemas/create-link";
import { serializeLink } from "../serializers/link";
import { resolveSlug } from "../services/slugs";
import type { AppEnv } from "../types";

/**
 * Declared with `createRoute` so the OpenAPI document accrues as routes land
 * (D22); prompt 19 assembles it. Response bodies are described there — this
 * carries the request contract, which is the half that validates.
 */
export const createLinkRoute = createRoute({
  method: "post",
  path: "/v1/links",
  summary: "Create a short link",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createLinkSchema } },
    },
  },
  responses: {
    201: { description: "The created link." },
    400: { description: "Malformed body, unknown field or bad value." },
    401: { description: "Missing or invalid API key." },
    409: { description: "The slug is already in use, including by a tombstone." },
    422: { description: "The destination failed validation, or the slug is reserved." },
  },
});

/** SQLite's wording, surfaced verbatim through D1. */
function isSlugUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: links\.slug/.test(err.message);
}

export function registerCreateLinkRoute(app: OpenAPIHono<AppEnv>): void {
  app.openapi(createLinkRoute, async (c) => {
    const body = c.req.valid("json");
    const key = c.get("key");

    if (key === undefined) {
      // Unreachable: auth middleware guards every path but the exempt two.
      throw new ApiError("unauthorized", "A valid API key is required.");
    }

    const resolved = await resolveSlug({
      db: c.env.DB,
      ...(body.slug === undefined ? {} : { custom: body.slug }),
    });

    if (!resolved.ok) {
      throw new ApiError(resolved.code, resolved.message, "slug");
    }

    // resolveSlug only SELECTs; it never reserves. A concurrent request can
    // take the slug in between, so UNIQUE(slug) is the real arbiter (design §6)
    // and the loser gets the contract's 409 rather than an unexplained 500.
    const row = await insertLink(c.env.DB, {
      slug: resolved.slug,
      destination: body.destination,
      redirectType: body.redirect_type,
      expiresAt: body.expires_at === undefined ? null : Date.parse(body.expires_at),
      externalId: body.external_id ?? null,
      createdByKeyId: key.id,
      at: Date.now(),
    }).catch((err: unknown) => {
      if (isSlugUniqueViolation(err)) {
        throw new ApiError("slug_taken", `Slug '${resolved.slug}' is already in use.`, "slug");
      }

      throw err;
    });

    if (row === null) {
      throw new Error("INSERT ... RETURNING produced no row");
    }

    // §7.3: implicit creation. Sequential rather than batched because each tag
    // needs its id back before it can be linked.
    const tags = body.tags ?? [];
    for (const name of tags) {
      const tag = await upsertTag(c.env.DB, name);
      if (tag === null) {
        throw new Error(`tag upsert produced no row for '${name}'`);
      }
      await attachTag(c.env.DB, row.id, tag.id);
    }

    // D20: D1 has committed; the KV put is awaited, so its failure is the
    // request's failure. The row stays behind on purpose — an idempotent
    // retry converges (prompt 11), and a fire-and-forget put would instead
    // leave a stale entry that backfill can never heal.
    await putRedirect(c.env.REDIRECTS, row.slug, redirectEntryFor(row));

    return c.json(serializeLink(row, tags, c.env.ENVIRONMENT), 201);
  });

  // After the handler — see methodNotAllowed's contract.
  methodNotAllowed(app, "/v1/links");
}
