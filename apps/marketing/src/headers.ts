/**
 * The same hardening the application sends, minus the parts that only mean
 * something where there is a session.
 *
 * The CSP is deliberately strict and cheap to keep that way: the site ships zero
 * client JavaScript, so `script-src 'none'` costs nothing and removes an entire
 * class of vulnerability. Styles are the single inline stylesheet in the page
 * shell. `form-action 'none'` because there are no forms here at all — the only
 * form on the public site was sign-out, which lives on the application.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'none'",
    "connect-src 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};
