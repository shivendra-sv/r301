import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { ApiError } from "../errors";
import { batchCreateSchema } from "../schemas/batch-create";
import { createLinkSchema } from "../schemas/create-link";
import {
  AUTHENTICATED_ROUTE_ERRORS,
  errorResponse,
  JSON_BODY_ERRORS,
} from "../schemas/error-envelope";
import { apiErrorFromZod } from "../schemas/fields";
import { batchResultSchema, jsonResponse } from "../schemas/resources";
import type { LinkResource } from "../serializers/link";
import { createLink } from "../services/links";
import type { AppEnv } from "../types";

export const batchCreateRoute = createRoute({
  method: "post",
  path: "/v1/links/batch",
  summary: "Create up to 100 short links",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: batchCreateSchema } },
    },
  },
  responses: {
    // 200 always (D22): per-item results carry the outcomes, so no single item
    // can fail the batch. The only 400 is a fault of the request as a whole.
    200: jsonResponse("Per-item results in request order, plus a summary.", batchResultSchema),
    400: errorResponse("`links` missing, not an array, empty, or over 100 items."),
    // D18: one key covers the whole batch, so a reused key with a different
    // payload fails the request as a whole — the only 4xx a batch can answer
    // besides a malformed wrapper.
    409: errorResponse(
      "The Idempotency-Key was reused with a different payload, or its original is still in flight.",
    ),
    ...AUTHENTICATED_ROUTE_ERRORS,
    ...JSON_BODY_ERRORS,
  },
});

/**
 * The per-item error object (api-contract §batch). `request_id` is deliberately
 * absent: the contract's example omits it, and it belongs to the *response* —
 * which here is a 200 carrying `X-Request-Id` once, rather than 100 copies of
 * one id inside a success body.
 */
interface BatchItemError {
  code: string;
  message: string;
  field?: string;
}

type BatchItem =
  | { index: number; status: "created"; link: LinkResource }
  | { index: number; status: "error"; error: BatchItemError };

function errorItem(index: number, err: ApiError): BatchItem {
  const error: BatchItemError = { code: err.code, message: err.message };

  if (err.field !== undefined) {
    error.field = err.field;
  }

  return { index, status: "error", error };
}

/**
 * Anything that is not an `ApiError` is an unexpected failure — the awaited KV
 * put is the one the contract names (`internal`, D20). It stays an item rather
 * than becoming the batch's status: §7.2 is explicit that one item never fails
 * the whole request, so the loop continues past it.
 */
function unexpectedItem(index: number): BatchItem {
  return {
    index,
    status: "error",
    error: { code: "internal", message: "An unexpected error occurred." },
  };
}

export function registerBatchCreateRoute(
  app: OpenAPIHono<AppEnv>,
  now: () => number,
  report: (err: unknown) => void,
): void {
  app.openapi(batchCreateRoute, async (c) => {
    const { links } = c.req.valid("json");
    const key = c.get("key");

    if (key === undefined) {
      // Unreachable: auth middleware guards every path but the exempt two.
      throw new ApiError("unauthorized", "A valid API key is required.");
    }

    const items: BatchItem[] = [];
    /** Indices whose failure was *not* a contracted outcome — question 26. */
    const unexpected: number[] = [];

    // Sequential, not parallel (§7.2, D22): D1's `batch()` is a transaction
    // that aborts on the first error, which is the opposite of per-item
    // results. Sequence is also what gives a slug repeated *within* one batch
    // its defined outcome — the first item wins, the second sees it taken.
    for (const [index, raw] of links.entries()) {
      const parsed = createLinkSchema.safeParse(raw);

      if (!parsed.success) {
        items.push(errorItem(index, apiErrorFromZod(parsed.error)));
        continue;
      }

      try {
        items.push({
          index,
          status: "created",
          link: await createLink({
            db: c.env.DB,
            kv: c.env.REDIRECTS,
            body: parsed.data,
            createdByKeyId: key.id,
            at: now(),
            environment: c.env.ENVIRONMENT,
          }),
        });
      } catch (err) {
        if (err instanceof ApiError) {
          items.push(errorItem(index, err));
        } else {
          unexpected.push(index);
          items.push(unexpectedItem(index));
        }
      }
    }

    // One report for the whole batch, not one per item: a 100-item send during
    // a KV outage should raise a single incident, not flood the quota at the
    // exact moment it is needed. §15's durable forensics are Sentry + D1, and a
    // batch answers 200 — so without this, `app.onError` never runs and these
    // failures reach nobody at all (question 26).
    //
    // Synthetic on purpose: the scrubber (D23) cleans `request`, `extra`,
    // `contexts` and breadcrumbs, but **not** an exception's own message, so the
    // original error is never passed through — its text is not ours to vouch
    // for. Counts and indices carry no destination, body or key.
    if (unexpected.length > 0) {
      report(
        new Error(
          `POST /v1/links/batch: ${unexpected.length} of ${items.length} item(s) ` +
            `failed unexpectedly (indices ${unexpected.join(", ")})`,
        ),
      );
    }

    const created = items.filter((item) => item.status === "created").length;

    return c.json({ items, summary: { created, failed: items.length - created } }, 200);
  });
}
