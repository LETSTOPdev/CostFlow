/**
 * CostFlow brand mark — a flow/funnel motif (friction funnelling down to a
 * single distilled cost), rendered in the product's indigo→violet gradient with
 * an emerald "yield" dot. Served publicly at `/brand/logo.svg` so Auth0
 * Universal Login can render the SAME logo the app header shows: one identity
 * across the product and the sign-in screen.
 *
 * Each SVG carries its own gradient id so the full logo and the compact header
 * mark can safely appear on the same page without id collisions.
 */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="CostFlow">
  <defs>
    <linearGradient id="cfLogoBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d5efc"/>
      <stop offset="0.55" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#a855f7"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="28" fill="url(#cfLogoBg)"/>
  <rect x="0.75" y="0.75" width="118.5" height="118.5" rx="27.25" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="1.5"/>
  <g fill="#ffffff">
    <rect x="30" y="34" width="60" height="11" rx="5.5" fill-opacity="0.96"/>
    <rect x="40" y="55" width="40" height="11" rx="5.5" fill-opacity="0.88"/>
    <rect x="50" y="76" width="20" height="11" rx="5.5" fill-opacity="0.80"/>
  </g>
  <circle cx="60" cy="99" r="4.5" fill="#34e5b0"/>
</svg>`;

/** Compact inline header mark (same motif, no HTTP request). */
export const HEADER_MARK = `<svg width="24" height="24" viewBox="0 0 120 120" aria-hidden="true" focusable="false" style="display:block;flex:none"><defs><linearGradient id="cfMarkBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d5efc"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs><rect width="120" height="120" rx="28" fill="url(#cfMarkBg)"/><g fill="#fff"><rect x="30" y="34" width="60" height="11" rx="5.5" fill-opacity="0.96"/><rect x="40" y="55" width="40" height="11" rx="5.5" fill-opacity="0.88"/><rect x="50" y="76" width="20" height="11" rx="5.5" fill-opacity="0.8"/></g><circle cx="60" cy="99" r="4.5" fill="#34e5b0"/></svg>`;
