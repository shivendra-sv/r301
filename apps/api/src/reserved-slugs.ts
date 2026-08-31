/**
 * Reserved slugs (PRD §7.1, D16). Blocked case-insensitively on custom *and*
 * auto-generated slugs, so a random 7-char hit retries rather than shipping.
 *
 * Curation: the words the PRD names, plus the system/infra paths a shortener
 * on an apex domain would otherwise shadow, the project's own names, and the
 * brands whose slugs would read as impersonation.
 */

/** Bump whenever the list changes — a change here is a contract change. */
export const RESERVED_SLUGS_VERSION = 1;

/**
 * Lowercase, deduplicated, sorted — the sort keeps additions to a one-line
 * diff. `v1` is shorter than the 3-char slug minimum and so already
 * unreachable; it stays because the PRD names it.
 */
export const RESERVED_SLUGS = [
  "about", "abuse", "account", "accounts", "admin", "administrator", "adobe", "airbnb",
  "alibaba", "alpha", "amazon", "amex", "anthropic", "api", "apis", "app", "apple",
  "application", "apps", "assets", "atlassian", "auth", "authentication", "authorization",
  "authorize", "aws", "azure", "beta", "billing", "bitbucket", "blog", "campaign", "campaigns",
  "canary", "careers", "cart", "cdn", "cert", "certificate", "changelog", "checkout", "cisco",
  "claude", "click", "clicks", "clinicos", "cloudflare", "company", "config", "configuration",
  "confluence", "console", "contact", "cookies", "copyright", "cpanel", "create", "css",
  "curastax", "dashboard", "debug", "default", "delete", "dell", "demo", "dev", "development",
  "discord", "dmca", "dns", "doc", "docs", "documentation", "downgrade", "download", "dropbox",
  "ebay", "edge", "edit", "email", "export", "external", "facebook", "faq", "favicon", "figma",
  "find", "fonts", "ftp", "gcp", "gdpr", "github", "gitlab", "google", "goto", "guide",
  "guides", "health", "healthz", "help", "home", "ibm", "image", "images", "imap", "img",
  "import", "imprint", "index", "instagram", "intel", "internal", "invoice", "invoices",
  "javascript", "jira", "jobs", "js", "keys", "legal", "link", "linkedin", "links", "list",
  "livez", "local", "localhost", "log", "login", "logout", "logs", "lyft", "mail", "main",
  "mastercard", "media", "meta", "metrics", "microsoft", "moderator", "monitor", "monitoring",
  "mx", "netflix", "new", "news", "none", "notion", "ns1", "ns2", "nvidia", "oauth", "oauth2",
  "openai", "oracle", "order", "orders", "owner", "panel", "password", "passwords", "payment",
  "payments", "paypal", "ping", "pinterest", "plans", "policies", "policy", "pop3", "portal",
  "preferences", "press", "preview", "pricing", "privacy", "private", "prod", "production",
  "profile", "public", "qrcode", "query", "r301", "r301dev", "readyz", "reddit", "redirect",
  "redirects", "refund", "refunds", "register", "remove", "roadmap", "robots", "root",
  "salesforce", "samsung", "sandbox", "search", "secret", "secrets", "secure", "security",
  "service", "services", "settings", "sftp", "share", "shared", "shopify", "short", "shorten",
  "shortener", "show", "signal", "signin", "signout", "signup", "site", "sitemap", "slack",
  "smtp", "snapchat", "sony", "spotify", "ssh", "ssl", "sso", "staff", "stage", "staging",
  "static", "stats", "status", "status-page", "stripe", "subscribe", "subscription", "super",
  "superuser", "support", "sys", "system", "team", "telegram", "telemetry", "terms", "test",
  "testing", "tiktok", "tls", "token", "tokens", "tos", "trace", "track", "tracking", "trial",
  "tutorial", "tutorials", "twitch", "twitter", "uber", "unsubscribe", "update", "upgrade",
  "upload", "uptime", "url", "urls", "user", "users", "utm", "v1", "v2", "v3", "v4", "v5",
  "view", "visa", "web", "webmail", "well-known", "whatsapp", "www", "www1", "www2", "youtube",
  "zoom",
] as const satisfies readonly string[];

const RESERVED = new Set<string>(RESERVED_SLUGS);

/** Case-insensitive by D16: `Admin` and `admin` are the same reservation. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.toLowerCase());
}
