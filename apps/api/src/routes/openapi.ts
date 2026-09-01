import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { methodNotAllowed } from "../middleware/errors";
import { PUBLIC_ROUTE_ERRORS } from "../schemas/error-envelope";
import { STANDARD_RESPONSE_HEADERS } from "../schemas/headers";
import type { AppEnv } from "../types";

/**
 * The document's front page. Everything a client needs before their first call
 * belongs here — the rest is on the operations themselves.
 */
const API_DESCRIPTION = [
  "r301.dev turns long URLs into short ones and serves the redirects from the edge. There is no"
    + " dashboard: this API is the product.",
  "",
  "## Two hosts",
  "",
  "This document describes the **management API** at `api.r301.dev`. Redirects are served from a"
    + " separate host — `https://r301.dev/{slug}` — which takes no API key and is not described"
    + " here. A short link is live at its `short_url` the moment a create call returns.",
  "",
  "## Authentication",
  "",
  "Send an API key as `Authorization: Bearer r301_live_…` on every `/v1` route except"
    + " `GET /v1/health` and `GET /v1/openapi.json`. Keys are issued out of band; there are no"
    + " key-management endpoints in v1. Revocation is immediate.",
  "",
  "Keys are account-wide: every live key can read and modify every link on the account. Treat"
    + " them as server-side secrets — there is no CORS, and they do not belong in a browser or a"
    + " mobile app.",
  "",
  "## Conventions",
  "",
  "- **JSON only.** A request with a body must send `Content-Type: application/json`, or it is"
    + " rejected with `415`.",
  "- **Strict requests, tolerant responses.** An unknown or misspelled field is a `400` naming"
    + " the field. New response fields may be added at any time — ignore the ones you do not"
    + " know rather than failing on them.",
  "- **Timestamps** are ISO 8601. Inputs may carry any offset and are normalised to UTC;"
    + " outputs are always UTC.",
  "- **Every response carries `X-Request-Id`.** Error bodies echo it as `request_id`. Quote it"
    + " in a support request.",
  "- **Errors share one shape** and one code vocabulary. Switch on `error.code`, not on the HTTP"
    + " status: two codes share `409` and two share `422`.",
  "- **Pagination** is cursor-based. Follow `next_cursor` until it is `null`; treat the cursor"
    + " as opaque.",
  "- **Versioning** is in the path. Breaking changes would arrive as `/v2`; everything within"
    + " `/v1` is additive.",
  "",
  "## Retries and consistency",
  "",
  "Both create endpoints honour `Idempotency-Key`, scoped to your key for 24 hours, which makes"
    + " a timed-out request safe to repeat. Retries must be byte-identical to replay rather than"
    + " conflict.",
  "",
  "Writes are durable before the response returns. Propagation to distant edge locations is"
    + " eventually consistent, so an edit or a deletion can take up to about 60 seconds to be"
    + " visible everywhere — the management API is immediately consistent, the redirect edge is"
    + " not.",
  "",
  "## Limits",
  "",
  "No per-key rate limits are enforced in v1, and no `RateLimit-*` headers are sent; the"
    + " `rate_limited` code is reserved for when they arrive. A batch is capped at 100 items,"
    + " tags at 10 per link, and a page at 100 links.",
].join("\n");

/** Operation groupings, declared so the document's own tags carry meaning. */
const TAG_GROUPS = [
  {
    name: "Links",
    description:
      "Create, read, update and delete short links, individually or 100 at a time. This is the"
      + " whole of the write surface.",
  },
  {
    name: "Tags & stats",
    description:
      "Click counts for a single link, aggregate totals for a tag, and the list of tags in use."
      + " Counts are read-only and at-least-approximate by design.",
  },
  {
    name: "Meta",
    description:
      "Unauthenticated endpoints about the service itself: the liveness probe and this"
      + " document. Safe to call before you have a key.",
  },
];

/** Applied to every operation by default; the two exempt paths opt out. */
export const BEARER_SCHEME_NAME = "bearerAuth";

export const OPENAPI_DOCUMENT_PATH = "/v1/openapi.json";

/**
 * `GET /v1/openapi.json` (PRD §8, D22). Served with `doc31` rather than `doc`:
 * the PRD asks for OpenAPI **3.1**, and `doc` emits 3.0.
 *
 * The config is a function of the request so `info.version` can read the
 * binding — it is the same string `GET /v1/health` reports, so a document and a
 * probe pulled from one deploy can never disagree about which deploy they are.
 */
export function registerOpenApiRoute(app: OpenAPIHono<AppEnv>): void {
  app.openAPIRegistry.registerComponent("securitySchemes", BEARER_SCHEME_NAME, {
    type: "http",
    scheme: "bearer",
    description:
      "An API key minted by `pnpm mint-key`, sent as `Authorization: Bearer r301_live_…`.",
  });

  // `doc31` registers the Hono handler but adds nothing to the registry, so the
  // document would omit itself. Registering the path (not a second handler)
  // makes it self-describing, which is what lets the security cross-check
  // compare against the auth middleware's exempt list with no special case.
  app.openAPIRegistry.registerPath({
    method: "get",
    path: OPENAPI_DOCUMENT_PATH,
    operationId: "getOpenApiDocument",
    tags: ["Meta"],
    summary: "This document",
    security: [],
    description:
      "Serves this OpenAPI 3.1 document, generated from the same schemas that validate every "
      + "request — so it describes what the deployed code actually accepts, not what a "
      + "hand-maintained file once said it did. **Unauthenticated**, so a client can generate "
      + "its SDK before it has a key.\n\n"
      + "`info.version` is the running deploy\u2019s git SHA, matching `GET /v1/health`. Fetch it "
      + "from the environment you are integrating against rather than trusting a copy.",
    responses: {
      ...PUBLIC_ROUTE_ERRORS,
      200: {
        description: "The OpenAPI 3.1 description of this API.",
        headers: STANDARD_RESPONSE_HEADERS,
        content: {
          // Loose on purpose: the body is an OpenAPI document, and restating
          // that specification inside itself would be a second copy of it to
          // maintain. The one field worth promising is which version it is.
          "application/json": {
            schema: z.looseObject({
              openapi: z.string().meta({
                description: "The OpenAPI specification version this document conforms to.",
                example: "3.1.0",
              }),
            }),
            example: {
              openapi: "3.1.0",
              info: { title: "r301.dev API", version: "047714d" },
            },
          },
        },
      },
    },
  });

  app.doc31(OPENAPI_DOCUMENT_PATH, (c) => ({
    openapi: "3.1.0",
    info: {
      title: "r301.dev API",
      version: c.env.GIT_SHA ?? "dev",
      summary: "An API-first URL shortener with a globally distributed redirect edge.",
      description: API_DESCRIPTION,
      contact: { name: "r301.dev", url: "https://www.r301.dev" },
      license: { name: "Proprietary", url: "https://www.r301.dev/terms" },
      termsOfService: "https://www.r301.dev/terms",
    },
    servers: [
      {
        url: "https://api.r301.dev",
        description: "Production. Links created here resolve at https://r301.dev/{slug}.",
      },
      {
        url: "https://api-staging.r301.dev",
        description:
          "Staging. Separate database, cache and API keys; links resolve at "
          + "https://staging.r301.dev/{slug}. Suitable for integration testing, not load "
          + "testing — it shares account-level quotas with production.",
      },
    ],
    tags: TAG_GROUPS,
    externalDocs: {
      url: "https://www.r301.dev/docs",
      description: "Guides, quickstarts and the redirect-edge contract.",
    },
    // Document-level default, deliberately: a route added without thinking
    // about auth is documented as authenticated, which is what the middleware
    // actually does to it. Opting out is the explicit act (`security: []`).
    security: [{ [BEARER_SCHEME_NAME]: [] }],
  }));

  methodNotAllowed(app, OPENAPI_DOCUMENT_PATH);
}
