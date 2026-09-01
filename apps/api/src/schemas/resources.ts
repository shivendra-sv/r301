// Response bodies, as schemas (api-contract §The Link resource, §stats, §tags).
//
// These are the source of both halves: the OpenAPI components the document
// publishes, and — via `z.infer` in the serializers — the TypeScript types the
// handlers must satisfy. One definition, so a documented field that the code
// stopped sending is a type error rather than a lie in the published contract.

import { z } from "@hono/zod-openapi";
import { redirectTypeSchema } from "./fields";
import { STANDARD_RESPONSE_HEADERS } from "./headers";

export const linkResourceSchema = z
  .object({
    slug: z.string().meta({
      description:
        "The path segment of the short URL. Assigned by you, or generated as 7 base62 "
        + "characters when you omit it. Immutable for the life of the link.",
      example: "aB3xY9k",
    }),
    /** Convenience field (D26.2); uses the environment's redirect host. */
    short_url: z.string().meta({
      description:
        "The full short URL, ready to paste into a message. Built from the environment's "
        + "redirect host, so a link created on staging returns a staging URL — never "
        + "hand-assemble this from `slug` and a hard-coded host.",
      example: "https://r301.dev/aB3xY9k",
    }),
    destination: z.string().meta({
      description: "Where the link currently sends visitors, byte for byte as it was stored.",
      example: "https://clinic.example.com/appt/9182?t=abc123",
    }),
    redirect_type: redirectTypeSchema,
    is_active: z.boolean().meta({
      description:
        "Whether the link redirects. When `false` the short URL answers `404` — the same as an "
        + "unknown link, so deactivation is indistinguishable from never having existed. This "
        + "is the immediate kill switch; `expires_at` is the scheduled one.",
      example: true,
    }),
    /** ISO 8601 UTC, or null when the link never expires. */
    expires_at: z.string().nullable().meta({
      description:
        "When the link stops redirecting, as an ISO 8601 UTC timestamp, or `null` if it never "
        + "expires. Past this instant the short URL answers `410 Gone`. Deactivation outranks "
        + "expiry: an inactive link answers `404` whether or not it has also expired.",
      example: "2026-09-30T12:00:00Z",
    }),
    tags: z.array(z.string()).meta({
      description:
        "The link's tags, as last written. An empty array means untagged; the field is never "
        + "`null`.",
      example: ["tenant:42", "kind:appointment"],
    }),
    external_id: z.string().nullable().meta({
      description: "Your own identifier for this link, or `null` if none was set.",
      example: "appt_9182",
    }),
    created_at: z.string().meta({
      description: "When the link was created, as an ISO 8601 UTC timestamp.",
      example: "2026-08-31T10:00:00Z",
    }),
    updated_at: z.string().meta({
      description:
        "When the link was last modified, as an ISO 8601 UTC timestamp. Equal to `created_at` "
        + "until the first `PATCH`. Click counting does **not** touch it — counts are not "
        + "modifications of the link.",
      example: "2026-08-31T10:00:00Z",
    }),
  })
  .meta({
    title: "Link",
    description:
      "A short link. **Click counts are deliberately absent** — they live on "
      + "`GET /v1/links/{slug}/stats`, so listing links stays a cheap read that never has to "
      + "aggregate counters.\n\n"
      + "Treat unknown fields as additive and ignore them: new fields may appear without a "
      + "version bump, and doing so is not a breaking change.",
    example: {
      slug: "aB3xY9k",
      short_url: "https://r301.dev/aB3xY9k",
      destination: "https://clinic.example.com/appt/9182?t=abc123",
      redirect_type: 302,
      is_active: true,
      expires_at: "2026-09-30T12:00:00Z",
      tags: ["tenant:42", "kind:appointment"],
      external_id: "appt_9182",
      created_at: "2026-08-31T10:00:00Z",
      updated_at: "2026-08-31T10:00:00Z",
    },
  })
  .openapi("Link");

/** Reused as the worked example wherever a single link is returned. */
export const LINK_EXAMPLE = {
  slug: "aB3xY9k",
  short_url: "https://r301.dev/aB3xY9k",
  destination: "https://clinic.example.com/appt/9182?t=abc123",
  redirect_type: 302,
  is_active: true,
  expires_at: "2026-09-30T12:00:00Z",
  tags: ["tenant:42", "kind:appointment"],
  external_id: "appt_9182",
  created_at: "2026-08-31T10:00:00Z",
  updated_at: "2026-08-31T10:00:00Z",
} as const;

export const linkListSchema = z
  .object({
    links: z.array(linkResourceSchema).meta({
      description:
        "One page of links, ordered by `created_at` descending — newest first. Deleted links "
        + "never appear. An empty array means no link matched, which is a `200`, not a `404`.",
    }),
    /** Null exactly when the last page has been reached. */
    next_cursor: z.string().nullable().meta({
      description:
        "Pass as `?cursor=` to fetch the next page, or `null` when this was the last page. "
        + "Treat it as an opaque token — it is a base64url keyset position whose encoding may "
        + "change. It does not expire, and it is stable against inserts: links created after "
        + "you started paging will not shift rows into or out of later pages.",
      example: "eyJjIjoxNzU2NjM2ODAwMDAwLCJpIjo0MjF9",
    }),
  })
  .meta({
    title: "Link list",
    description: "A page of links plus the cursor for the next one.",
    example: { links: [LINK_EXAMPLE], next_cursor: null },
  })
  .openapi("LinkList");

/**
 * The per-item error inside a batch. Deliberately *not* the error envelope:
 * it carries no `request_id`, because the batch's own 200 response carries
 * `X-Request-Id` once rather than repeating one id up to 100 times
 * (api-contract §batch; PROGRESS question 25).
 */
const batchItemErrorSchema = z.object({
  code: z.string().meta({
    description:
      "The same code vocabulary as the error envelope — most often `slug_taken`, "
      + "`slug_reserved`, `destination_invalid` or `invalid_request`.",
    example: "slug_taken",
  }),
  message: z.string().meta({
    description: "A human-readable explanation of why this one item failed.",
    example: "Slug 'launch' is already in use.",
  }),
  field: z.string().optional().meta({
    description: "The field of this item at fault, when exactly one is.",
    example: "slug",
  }),
});

export const batchResultSchema = z
  .object({
    items: z
      .array(
        // Discriminated on `status` rather than a plain union: a plain union
        // emits two untitled `object` branches, which renderers show as
        // "Any of object / object" with no way to tell which is which.
        // Registering each branch as a named component is what earns a real
        // OpenAPI `discriminator` with a `mapping`, so tools can label the two
        // outcomes and generate a tagged union instead of a shapeless one.
        z.discriminatedUnion("status", [
          z.object({
            index: z.int().meta({
              description:
                "The zero-based position of this item in the `links` array you sent. Results "
                + "are returned in request order, so this is also its index here — match on it "
                + "rather than assuming.",
              example: 0,
            }),
            status: z.literal("created").meta({
              description: "This item was created.",
              example: "created",
            }),
            link: linkResourceSchema.meta({
              description: "The created link, identical to what a single create would have returned.",
            }),
          }).openapi("BatchItemCreated"),
          z.object({
            index: z.int().meta({
              description: "The zero-based position of this item in the `links` array you sent.",
              example: 1,
            }),
            status: z.literal("error").meta({
              description: "This item failed; the others were unaffected.",
              example: "error",
            }),
            error: batchItemErrorSchema.meta({
              description: "Why this item failed.",
            }),
          }).openapi("BatchItemFailed"),
        ]),
      )
      .meta({
        description:
          "One result per submitted item, in request order. Each is either a `created` entry "
          + "carrying the link, or an `error` entry carrying the reason.",
      }),
    summary: z
      .object({
        created: z.int().meta({ description: "How many items were created.", example: 1 }),
        failed: z.int().meta({ description: "How many items failed.", example: 1 }),
      })
      .meta({
        description:
          "Totals across the batch. `created + failed` always equals the number of items you "
          + "sent, so a mismatch means a truncated response.",
      }),
  })
  .meta({
    title: "Batch result",
    description:
      "The outcome of a bulk create. **A batch always answers `200`**, even when every item "
      + "failed — the status describes the request, and the items describe the work. Check "
      + "`summary.failed` rather than the HTTP status.\n\n"
      + "Items are processed sequentially and are **not** transactional: successful items stay "
      + "created even if later ones fail. There is no partial rollback, so retry only the "
      + "failed indices (with a fresh `Idempotency-Key`, since one key covers a whole batch).",
    example: {
      items: [
        { index: 0, status: "created", link: LINK_EXAMPLE },
        {
          index: 1,
          status: "error",
          error: {
            code: "slug_taken",
            message: "Slug 'launch' is already in use.",
            field: "slug",
          },
        },
      ],
      summary: { created: 1, failed: 1 },
    },
  })
  .openapi("BatchResult");

export const linkStatsSchema = z
  .object({
    slug: z.string().meta({ description: "The link these counts belong to.", example: "aB3xY9k" }),
    /** At-least-approximate by design (PRD §7.4, D21). */
    click_count: z.int().meta({
      description:
        "How many times the link has been followed. **At-least-approximate by design**: "
        + "counting happens after the redirect has been sent, so a count may be lost rather "
        + "than delay a visitor. Observed drift is under 0.1%.\n\n"
        + "Only successful GET redirects count. `HEAD` requests, `404`s, `410`s, and any "
        + "request whose user-agent matches the bot denylist (messenger link previews, email "
        + "link scanners, crawlers, HTTP tooling) are excluded — which is why this number is "
        + "typically *lower* than a raw access log for the same link. Scanners with "
        + "browser-like user-agents are not detectable and do still count.",
      example: 123,
    }),
    last_clicked_at: z.string().nullable().meta({
      description:
        "When the link was last followed, as an ISO 8601 UTC timestamp, or `null` if it never "
        + "has been. Subject to the same filtering as `click_count`.",
      example: "2026-09-01T08:14:22Z",
    }),
    created_at: z.string().meta({
      description: "When the link was created, so a rate can be computed without a second call.",
      example: "2026-08-31T10:00:00Z",
    }),
  })
  .meta({
    title: "Link stats",
    description: "Click totals for one link, kept separate from the link resource itself.",
    example: {
      slug: "aB3xY9k",
      click_count: 123,
      last_clicked_at: "2026-09-01T08:14:22Z",
      created_at: "2026-08-31T10:00:00Z",
    },
  })
  .openapi("LinkStats");

export const tagStatsSchema = z
  .object({
    tag: z.string().meta({
      description: "The tag these totals cover, echoed from the query.",
      example: "tenant:42",
    }),
    link_count: z.int().meta({
      description:
        "How many live links carry this tag. Deleted links are excluded. An unknown tag "
        + "reports `0` rather than `404` — there is nothing to probe for.",
      example: 17,
    }),
    click_count: z.int().meta({
      description:
        "Total clicks across every live link carrying this tag, with the same filtering and "
        + "the same at-least-approximate guarantee as a single link's count.",
      example: 940,
    }),
  })
  .meta({
    title: "Tag stats",
    description: "Aggregate totals across every live link carrying one tag.",
    example: { tag: "tenant:42", link_count: 17, click_count: 940 },
  })
  .openapi("TagStats");

export const tagListSchema = z
  .object({
    tags: z
      .array(
        z.object({
          name: z.string().meta({
            description: "The tag name, exactly as it was written on the links carrying it.",
            example: "kind:appointment",
          }),
          link_count: z.int().meta({
            description: "How many live links carry it.",
            example: 12,
          }),
        }),
      )
      .meta({
        description:
          "Every tag in use, sorted by name. Tags with no live links left do not appear. "
          + "Unpaginated in v1 — pilot tag cardinality is small; if yours approaches a thousand, "
          + "say so before relying on this.",
      }),
  })
  .meta({
    title: "Tag list",
    description: "Every tag currently in use, with its live link count.",
    example: {
      tags: [
        { name: "kind:appointment", link_count: 12 },
        { name: "tenant:42", link_count: 17 },
      ],
    },
  })
  .openapi("TagList");

export const healthSchema = z
  .object({
    status: z.literal("ok").meta({
      description: "Always `ok` — any other outcome is a non-200 or no response at all.",
      example: "ok",
    }),
    /** The deploy's git SHA, or "dev" when none was injected. */
    version: z.string().meta({
      description:
        "The git SHA of the running deploy, or `dev` when none was injected. The same string "
        + "appears as `info.version` in the served OpenAPI document, so a document and a probe "
        + "taken from one deploy can never disagree about which deploy they are — which is what "
        + "makes “which release broke it” answerable.",
      example: "047714d",
    }),
    env: z.string().meta({
      description: "Which environment answered: `production` or `staging`.",
      example: "production",
    }),
  })
  .meta({
    title: "Health",
    description:
      "Liveness of the Worker itself. Reads configuration only — it deliberately touches "
      + "neither the database nor the cache, so a storage incident cannot take the probe down "
      + "with it. It is therefore a liveness check, not a dependency check.",
    example: { status: "ok", version: "047714d", env: "production" },
  })
  .openapi("Health");

/**
 * Wraps a response body schema in the one content type this API speaks (D22),
 * with the headers every response carries and a worked example.
 *
 * The example is a **required** argument: a response a client cannot picture is
 * one they will get wrong, and making it optional is how half the responses end
 * up without one.
 */
export function jsonResponse<
  T extends z.ZodType,
  H extends z.ZodObject = typeof STANDARD_RESPONSE_HEADERS,
>(description: string, schema: T, example: unknown, headers?: H) {
  return {
    description,
    // The generic is what keeps the concrete object type: zod-openapi needs a
    // `ZodObject` to render header docs, and a widened `ZodType` is rejected.
    headers: (headers ?? STANDARD_RESPONSE_HEADERS) as H,
    content: { "application/json": { schema, example } },
  };
}
