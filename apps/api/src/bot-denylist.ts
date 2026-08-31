// Versioned UA denylist (design.md §10, PRD §7.4 D21). Git *is* the versioning:
// the pilot tunes this list from redirect-path logs, so every change to it is a
// reviewable diff with a date attached.
//
// Entries are **lowercase substrings** — `shouldCount` lowercases the UA and
// asks whether any entry appears in it. Substrings, not patterns, because real
// UAs carry version suffixes nobody can enumerate (`WhatsApp/2.24.10.75 A`).
//
// **UptimeRobot is deliberately absent.** The §15 canary probe hits its slug
// every 60 s, so its 1,440 counts/day are the drift instrument D21 measures
// against: the moment the probe stops being counted, the ruler is gone. Never
// add it — nor any other monitoring UA aimed at the canary.
//
// Honest limitation (PRD §7.4): scanners that present a browser-like UA slip
// through. The residual is documented rather than hidden.
export const BOT_DENYLIST: readonly string[] = [
  // Messenger preview fetchers — the pilot sends over SMS and WhatsApp.
  "whatsapp",
  "facebookexternalhit",
  "facebot",
  "telegrambot",
  "twitterbot",
  "slackbot",
  "discordbot",
  "linkedinbot",
  "skypeuripreview",
  // Crawlers and safe-browsing checks.
  "googlebot",
  "google-safebrowsing",
  "bingbot",
  "applebot",
  // Email link scanners — the pilot also sends over email.
  "safelinks",
  "proofpoint",
  "mimecast",
  "barracuda",
  // HTTP tooling and headless browsers.
  "curl",
  "wget",
  "python-requests",
  "go-http-client",
  "okhttp",
  "headlesschrome",
];
