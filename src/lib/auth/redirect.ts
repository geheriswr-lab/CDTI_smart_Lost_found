/**
 * Only same-site relative paths are allowed as a post-login / post-confirm
 * destination. "//evil.com", "/\\evil.com" start with "/" but browsers treat
 * them as another host, and "@evil.com" appended to an origin
 * ("https://site@evil.com") changes the host too → open redirect / phishing.
 */
export function isSafeRedirect(path: string | null | undefined): path is string {
  return typeof path === "string" && /^\/(?![\/\\])[^\s\\]*$/.test(path);
}

export function safeRedirectPath(path: string | null | undefined, fallback = "/dashboard"): string {
  return isSafeRedirect(path) ? path : fallback;
}
