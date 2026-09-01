import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  attachTag,
  detachAllTags,
  findLiveLinkBySlug,
  findTagNamesForLinks,
  listLinks,
  tombstoneLinkBySlug,
  updateLink,
  upsertTag,
} from "../db/queries";
import { ApiError } from "../errors";
import { putRedirect, redirectEntryFor, removeRedirect } from "../kv/redirects-cache";
import { methodNotAllowed } from "../middleware/errors";
import { createLinkSchema } from "../schemas/create-link";
import {
  AUTHENTICATED_ROUTE_ERRORS,
  errorResponse,
  JSON_BODY_ERRORS,
} from "../schemas/error-envelope";
import { listLinksQuerySchema } from "../schemas/list-query";
import { patchLinkSchema } from "../schemas/patch-link";
import { jsonResponse, linkListSchema, linkResourceSchema } from "../schemas/resources";
import { serializeLink } from "../serializers/link";
import { decodeCursor, encodeCursor } from "../services/cursor";
import { createLink } from "../services/links";
import type { AppEnv } from "../types";
import { registerBatchCreateRoute } from "./batch";
import { registerLinkStatsRoute } from "./stats";

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
    201: jsonResponse("The created link.", linkResourceSchema),
    400: errorResponse("Malformed body, unknown field or bad value."),
    ...AUTHENTICATED_ROUTE_ERRORS,
    ...JSON_BODY_ERRORS,
    409: errorResponse(
      "The slug is already in use (including by a tombstone), or the "
      + "Idempotency-Key was reused with a different payload.",
    ),
    422: errorResponse("The destination failed validation, or the slug is reserved."),
  },
});

/**
 * The path param carries no format schema on purpose: api-contract §GET one
 * says "unknown or tombstoned → 404", and a malformed slug is simply one that
 * cannot exist. Answering 400 for `ab` and 404 for `abc` would split one
 * outcome — "no such link" — across two statuses.
 */
const slugParamSchema = z.object({ slug: z.string() });

export const getLinkRoute = createRoute({
  method: "get",
  path: "/v1/links/{slug}",
  summary: "Fetch one link",
  request: { params: slugParamSchema },
  responses: {
    200: jsonResponse("The link.", linkResourceSchema),
    ...AUTHENTICATED_ROUTE_ERRORS,
    404: errorResponse("No such link, or it has been deleted."),
  },
});

function registerGetLinkRoute(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getLinkRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const row = await findLiveLinkBySlug(c.env.DB, slug);

    if (row === null) {
      throw new ApiError("not_found", "Resource not found.");
    }

    const tags = await findTagNamesForLinks(c.env.DB, [row.id]);

    return c.json(serializeLink(row, tags.get(row.id) ?? [], c.env.ENVIRONMENT), 200);
  });
}

function registerCreateLinkRoute(app: OpenAPIHono<AppEnv>, now: () => number): void {
  app.openapi(createLinkRoute, async (c) => {
    const body = c.req.valid("json");
    const key = c.get("key");

    if (key === undefined) {
      // Unreachable: auth middleware guards every path but the exempt two.
      throw new ApiError("unauthorized", "A valid API key is required.");
    }

    // The whole sequence lives in services/links.ts so batch (§7.2) creates
    // links by the same steps rather than a parallel copy of them. Every
    // failure it raises is already the contract's, so it travels untouched to
    // the error handler — batch is the caller that catches instead.
    const link = await createLink({
      db: c.env.DB,
      kv: c.env.REDIRECTS,
      body,
      createdByKeyId: key.id,
      at: now(),
      environment: c.env.ENVIRONMENT,
    });

    return c.json(link, 201);
  });
}

export const listLinksRoute = createRoute({
  method: "get",
  path: "/v1/links",
  summary: "List links",
  request: { query: listLinksQuerySchema },
  responses: {
    200: jsonResponse("A page of links, newest first, with the next cursor.", linkListSchema),
    400: errorResponse("Unknown filter, bad value or an unreadable cursor."),
    ...AUTHENTICATED_ROUTE_ERRORS,
  },
});

function registerListLinksRoute(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listLinksRoute, async (c) => {
    const query = c.req.valid("query");

    // Decoded here rather than in the schema: the handler cannot forget to,
    // since it needs the position to build the query at all.
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

    if (after === null) {
      throw new ApiError("invalid_request", "The cursor is not one this API issued.", "cursor");
    }

    // One row beyond the page: its presence is what distinguishes "more to
    // come" from "exhausted", so `next_cursor` is null exactly at the end
    // rather than one empty page later.
    const rows = await listLinks(c.env.DB, {
      ...(query.tag === undefined ? {} : { tag: query.tag }),
      ...(query.active === undefined ? {} : { isActive: query.active ? 1 : 0 }),
      ...(query.created_after === undefined
        ? {}
        : { createdAfter: Date.parse(query.created_after) }),
      ...(query.external_id === undefined ? {} : { externalId: query.external_id }),
      ...(after === undefined ? {} : { after }),
      limit: query.limit + 1,
    });

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > query.limit && last !== undefined
        ? encodeCursor({ createdAt: last.created_at, id: last.id })
        : null;

    const tags = await findTagNamesForLinks(
      c.env.DB,
      page.map((row) => row.id),
    );

    return c.json(
      {
        links: page.map((row) => serializeLink(row, tags.get(row.id) ?? [], c.env.ENVIRONMENT)),
        next_cursor: nextCursor,
      },
      200,
    );
  });
}

export const patchLinkRoute = createRoute({
  method: "patch",
  path: "/v1/links/{slug}",
  summary: "Update a link",
  request: {
    params: slugParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: patchLinkSchema } },
    },
  },
  responses: {
    200: jsonResponse("The updated link.", linkResourceSchema),
    400: errorResponse("Empty body, unknown field (including `slug`) or bad value."),
    ...AUTHENTICATED_ROUTE_ERRORS,
    ...JSON_BODY_ERRORS,
    404: errorResponse("No such link, or it has been deleted."),
    422: errorResponse("The new destination failed validation."),
  },
});

/**
 * Attaches `names` in the order given, after clearing what was there — `tags`
 * replaces the set rather than merging it (D26.5). Order is preserved because
 * the Link resource reads tags back in attach order (see PROGRESS question 21),
 * so a round-trip through PATCH must not reshuffle them.
 */
async function replaceTags(
  db: D1Database,
  linkId: number,
  names: readonly string[],
): Promise<void> {
  await detachAllTags(db, linkId);

  for (const name of names) {
    const tag = await upsertTag(db, name);
    if (tag === null) {
      throw new Error(`tag upsert produced no row for '${name}'`);
    }
    await attachTag(db, linkId, tag.id);
  }
}

function registerPatchLinkRoute(app: OpenAPIHono<AppEnv>, now: () => number): void {
  app.openapi(patchLinkRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const body = c.req.valid("json");

    const existing = await findLiveLinkBySlug(c.env.DB, slug);

    if (existing === null) {
      throw new ApiError("not_found", "Resource not found.");
    }

    const row = await updateLink(
      c.env.DB,
      existing.id,
      {
        ...(body.destination === undefined ? {} : { destination: body.destination }),
        ...(body.redirect_type === undefined ? {} : { redirectType: body.redirect_type }),
        ...(body.expires_at === undefined
          ? {}
          : { expiresAt: body.expires_at === null ? null : Date.parse(body.expires_at) }),
        ...(body.is_active === undefined ? {} : { isActive: body.is_active ? 1 : 0 }),
        ...(body.external_id === undefined ? {} : { externalId: body.external_id }),
      },
      now(),
    );

    if (row === null) {
      // Tombstoned between the lookup and the write.
      throw new ApiError("not_found", "Resource not found.");
    }

    if (body.tags !== undefined) {
      await replaceTags(c.env.DB, row.id, body.tags);
    }

    // Read back rather than echoing `body.tags`: `link_tags` is keyed
    // (link_id, tag_id), so `["b","b"]` stores one row, and echoing would
    // report a set the next GET disagrees with.
    const tags = (await findTagNamesForLinks(c.env.DB, [row.id])).get(row.id) ?? [];

    // D20, exactly as create: D1 has committed, the put is awaited, and its
    // failure is the request's failure. The updated row stays behind — an
    // identical PATCH is naturally idempotent and converges.
    await putRedirect(c.env.REDIRECTS, row.slug, redirectEntryFor(row));

    return c.json(serializeLink(row, tags, c.env.ENVIRONMENT), 200);
  });
}

export const deleteLinkRoute = createRoute({
  method: "delete",
  path: "/v1/links/{slug}",
  summary: "Delete a link",
  request: { params: slugParamSchema },
  responses: {
    204: { description: "Tombstoned. No body." },
    ...AUTHENTICATED_ROUTE_ERRORS,
    404: errorResponse("No such link, or it was already deleted."),
  },
});

function registerDeleteLinkRoute(app: OpenAPIHono<AppEnv>, now: () => number): void {
  app.openapi(deleteLinkRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const tombstoned = await tombstoneLinkBySlug(c.env.DB, slug, now());

    if (tombstoned === null) {
      throw new ApiError("not_found", "Resource not found.");
    }

    // D20, and a *delete* rather than a put with `a:0`: a deactivated link is
    // still resolvable, a tombstoned one must leave KV unset so the redirect
    // path falls through to D1 and 404s without backfilling (design §3's
    // no-negative-caching rule). Awaited, so a failure is the request's.
    await removeRedirect(c.env.REDIRECTS, slug);

    return c.body(null, 204);
  });
}

/**
 * Every `/v1/links…` handler, in the one order that works, on two counts:
 *
 * 1. `methodNotAllowed` registers `app.all(path)`, and Hono matches in
 *    registration order, so each 405 guard must come **after** every method
 *    handler for its path — a GET declared after the guard would answer 405
 *    instead of listing.
 * 2. `/v1/links/batch` is a literal segment that `/v1/links/:slug` also
 *    matches, so batch must be registered **before** the `:slug` family.
 *    Registered after it, `POST /v1/links/batch` answers 405 (swallowed by the
 *    `:slug` 405 guard) rather than creating anything.
 *
 * Keeping the whole path family in one function is what stops either from
 * being rediscovered by a failing test in a later prompt.
 */
export interface LinkRoutesOptions {
  /** Clock for `created_at`/`updated_at`, shared by every route here. Injected in tests. */
  now?: () => number;
}

export function registerLinkRoutes(
  app: OpenAPIHono<AppEnv>,
  options: LinkRoutesOptions = {},
): void {
  const now = options.now ?? (() => Date.now());

  registerCreateLinkRoute(app, now);
  registerListLinksRoute(app);

  // Before the `:slug` family and its 405 guard — see (2) above.
  registerBatchCreateRoute(app, now);
  methodNotAllowed(app, "/v1/links/batch");

  // Three segments deep, so `/v1/links/:slug` (two) cannot match it and the
  // order is not load-bearing the way batch's is — registered here anyway so
  // the whole `/v1/links…` family stays in one readable sequence.
  registerLinkStatsRoute(app);
  methodNotAllowed(app, "/v1/links/:slug/stats");

  registerGetLinkRoute(app);
  registerPatchLinkRoute(app, now);
  registerDeleteLinkRoute(app, now);

  methodNotAllowed(app, "/v1/links");
  methodNotAllowed(app, "/v1/links/:slug");
}
