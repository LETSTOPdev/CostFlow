/**
 * CostFlow brand mark — a flow/funnel motif (friction funnelling down to a
 * single cost), in the product's brand blue. Served publicly at
 * `/brand/logo.svg` so Auth0 Universal Login can render the SAME logo the app
 * header shows: one identity across the product and the sign-in screen.
 */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="CostFlow">
  <rect width="120" height="120" rx="26" fill="#0645ad"/>
  <g fill="#ffffff">
    <rect x="28" y="34" width="64" height="12" rx="6"/>
    <rect x="38" y="54" width="44" height="12" rx="6"/>
    <rect x="48" y="74" width="24" height="12" rx="6"/>
  </g>
</svg>`;

/** Compact inline header mark (same motif, no HTTP request). */
export const HEADER_MARK = `<svg width="22" height="22" viewBox="0 0 120 120" aria-hidden="true" focusable="false" style="vertical-align:-4px;margin-right:0.4rem"><rect width="120" height="120" rx="26" fill="#0645ad"/><g fill="#fff"><rect x="28" y="34" width="64" height="12" rx="6"/><rect x="38" y="54" width="44" height="12" rx="6"/><rect x="48" y="74" width="24" height="12" rx="6"/></g></svg>`;
