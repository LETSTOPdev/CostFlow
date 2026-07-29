import { esc } from '@costflow/ui';
import type { AdminAuditRow, AdminCounts } from './store/contract';

/**
 * Server-rendered internal operations console (COSTFLOW_ADMIN_EMAILS only).
 * Zero client JavaScript: every interaction — search, filter, sort, paginate —
 * is a GET with query params, and every action is a CSRF-protected POST. The
 * CSP (`script-src 'none'`) is preserved. Styling is a single scoped inline
 * <style> block (allowed by `style-src 'unsafe-inline'`); nothing loads from a
 * CDN. Rendering is pure: these functions take already-fetched data and return
 * HTML strings, so they are trivially unit-testable.
 */

export interface AdminSection {
  readonly key: string;
  readonly label: string;
  readonly href: string;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: 'overview', label: 'Overview', href: '/admin' },
  { key: 'customers', label: 'Customers', href: '/admin/customers' },
  { key: 'tenants', label: 'Organizations', href: '/admin/tenants' },
  { key: 'monitoring', label: 'Monitoring', href: '/admin/monitoring' },
  { key: 'funnel', label: 'Funnel', href: '/admin/funnel' },
  { key: 'activity', label: 'Activity', href: '/admin/activity' },
  { key: 'workspaces', label: 'Connections', href: '/admin/workspaces' },
  { key: 'jobs', label: 'Imports', href: '/admin/jobs' },
  { key: 'runs', label: 'Runs', href: '/admin/runs' },
  { key: 'invitations', label: 'Invitations', href: '/admin/invitations' },
  { key: 'audit', label: 'Audit log', href: '/admin/audit' },
  { key: 'system', label: 'System', href: '/admin/system' },
];

/** Serialize a query object to a URL, dropping empty/undefined values. */
export function adminQuery(
  base: string,
  params: Record<string, string | number | undefined | null>,
): string {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length > 0 ? `${base}?${pairs.join('&')}` : base;
}

const STYLES = `<style>
.adm{--adm-bg:#f6f7f9;--adm-panel:#fff;--adm-line:#e4e7ec;--adm-fg:#1a1d24;--adm-mut:#667085;--adm-acc:#5b47e0;--adm-acc-fg:#fff;--adm-hover:#f0f1f4;color:var(--adm-fg);}
@media (prefers-color-scheme:dark){.adm{--adm-bg:#0c0d12;--adm-panel:#14161d;--adm-line:#262a34;--adm-fg:#e7e9ee;--adm-mut:#9aa2b1;--adm-acc:#8b7bf0;--adm-hover:#1b1e27;}}
.adm{max-width:1200px;margin:0 auto;padding:1.25rem 1.25rem 4rem;}
.adm-top{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;border-bottom:1px solid var(--adm-line);padding-bottom:1rem;margin-bottom:1rem;}
.adm-top h1{font-size:1.15rem;margin:0;letter-spacing:-.01em;}
.adm-env{font:600 .7rem/1 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.04em;padding:.28rem .5rem;border-radius:999px;background:var(--adm-hover);color:var(--adm-mut);border:1px solid var(--adm-line);}
.adm-search{margin-left:auto;display:flex;gap:.4rem;}
.adm-search input{background:var(--adm-panel);border:1px solid var(--adm-line);color:var(--adm-fg);border-radius:8px;padding:.45rem .6rem;min-width:16rem;font-size:.9rem;}
.adm-nav{display:flex;gap:.15rem;flex-wrap:wrap;margin-bottom:1.25rem;}
.adm-nav a{padding:.4rem .7rem;border-radius:8px;text-decoration:none;color:var(--adm-mut);font-size:.9rem;font-weight:500;}
.adm-nav a:hover{background:var(--adm-hover);color:var(--adm-fg);}
.adm-nav a.on{background:var(--adm-acc);color:var(--adm-acc-fg);}
.adm h2{font-size:1rem;margin:1.5rem 0 .75rem;}
.adm-sub{color:var(--adm-mut);font-size:.88rem;margin:.15rem 0 0;}
.adm-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.7rem;margin:1rem 0;}
.adm-card{background:var(--adm-panel);border:1px solid var(--adm-line);border-radius:12px;padding:.85rem 1rem;}
.adm-card .n{font:700 1.5rem/1.1 ui-sans-serif,system-ui;letter-spacing:-.02em;}
.adm-card .l{color:var(--adm-mut);font-size:.78rem;margin-top:.2rem;text-transform:uppercase;letter-spacing:.03em;}
.adm-card.warn .n{color:#d9480f;}@media(prefers-color-scheme:dark){.adm-card.warn .n{color:#ff922b;}}
.adm-panel{background:var(--adm-panel);border:1px solid var(--adm-line);border-radius:12px;overflow:hidden;}
.adm-tablewrap{overflow-x:auto;}
table.adm-t{width:100%;border-collapse:collapse;font-size:.875rem;}
.adm-t th{text-align:left;font-weight:600;color:var(--adm-mut);padding:.6rem .8rem;border-bottom:1px solid var(--adm-line);white-space:nowrap;font-size:.78rem;text-transform:uppercase;letter-spacing:.03em;}
.adm-t th a{color:inherit;text-decoration:none;}
.adm-t th a:hover{color:var(--adm-fg);}
.adm-t td{padding:.55rem .8rem;border-bottom:1px solid var(--adm-line);vertical-align:top;}
.adm-t tr:last-child td{border-bottom:none;}
.adm-t tbody tr:hover{background:var(--adm-hover);}
.adm-t td.r,.adm-t th.r{text-align:right;}
.adm-mono{font:.82rem/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--adm-mut);}
.adm-t a{color:var(--adm-acc);text-decoration:none;}.adm-t a:hover{text-decoration:underline;}
.adm-empty{padding:2rem;text-align:center;color:var(--adm-mut);}
.adm-bar{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin:.5rem 0 1rem;}
.adm-bar input,.adm-bar select{background:var(--adm-panel);border:1px solid var(--adm-line);color:var(--adm-fg);border-radius:8px;padding:.4rem .55rem;font-size:.875rem;}
.adm-bar button{background:var(--adm-acc);color:var(--adm-acc-fg);border:none;border-radius:8px;padding:.42rem .8rem;font-size:.875rem;font-weight:600;cursor:pointer;}
.adm-bar .clr{color:var(--adm-mut);text-decoration:none;font-size:.85rem;padding:.4rem;}
.adm-pg{display:flex;align-items:center;gap:.8rem;justify-content:flex-end;margin-top:.8rem;color:var(--adm-mut);font-size:.85rem;}
.adm-pg a{color:var(--adm-acc);text-decoration:none;padding:.3rem .6rem;border:1px solid var(--adm-line);border-radius:7px;}
.adm-pg span.off{opacity:.4;padding:.3rem .6rem;border:1px solid var(--adm-line);border-radius:7px;}
.adm-badge{display:inline-block;padding:.15rem .5rem;border-radius:999px;font:600 .74rem/1.4 ui-sans-serif,system-ui;border:1px solid transparent;}
.adm-b-ok{background:#e6f4ea;color:#137333;}.adm-b-warn{background:#fff4e5;color:#b35309;}.adm-b-err{background:#fce8e6;color:#c5221f;}.adm-b-mut{background:var(--adm-hover);color:var(--adm-mut);}.adm-b-info{background:#e8f0fe;color:#1a56db;}
@media(prefers-color-scheme:dark){.adm-b-ok{background:#0f2a1a;color:#5bd98a;}.adm-b-warn{background:#2e2109;color:#ffb454;}.adm-b-err{background:#2c1113;color:#ff7a7a;}.adm-b-info{background:#12203f;color:#7ba9ff;}}
.adm-kv{display:grid;grid-template-columns:max-content 1fr;gap:.35rem 1.2rem;padding:1rem;font-size:.9rem;}
.adm-kv dt{color:var(--adm-mut);}
.adm-kv dd{margin:0;font-variant-numeric:tabular-nums;}
.adm-tl{list-style:none;margin:0;padding:1rem 1.2rem;}
.adm-tl li{position:relative;padding:0 0 .9rem 1.1rem;border-left:2px solid var(--adm-line);}
.adm-tl li:last-child{border-left-color:transparent;padding-bottom:0;}
.adm-tl li::before{content:"";position:absolute;left:-5px;top:.35rem;width:8px;height:8px;border-radius:50%;background:var(--adm-acc);}
.adm-tl .t{font-size:.9rem;}.adm-tl .d{color:var(--adm-mut);font-size:.78rem;font-family:ui-monospace,monospace;}
.adm-actions{display:flex;gap:.4rem;flex-wrap:wrap;}
.adm-actions form{display:inline;}
.adm-btn{background:var(--adm-panel);border:1px solid var(--adm-line);color:var(--adm-fg);border-radius:7px;padding:.3rem .55rem;font-size:.8rem;cursor:pointer;text-decoration:none;display:inline-block;}
.adm-btn:hover{background:var(--adm-hover);}
.adm-btn.danger{color:#c5221f;border-color:#f3b0ab;}
.adm-sel{background:var(--adm-panel);border:1px solid var(--adm-line);color:var(--adm-fg);border-radius:6px;padding:.25rem .35rem;font-size:.8rem;}
.adm-confirm{background:var(--adm-panel);border:1px solid var(--adm-line);border-radius:12px;padding:1.5rem;max-width:34rem;margin:1rem 0;}
.adm-confirm h2{margin-top:0;}
.adm-confirm .warn{color:#c5221f;font-weight:600;}
.adm-note{color:var(--adm-mut);font-size:.82rem;margin-top:1rem;}
.adm-card .s{color:var(--adm-mut);font-size:.75rem;margin-top:.3rem;font-variant-numeric:tabular-nums;}
.adm-card .n{font-variant-numeric:tabular-nums;}
.adm-chart{display:flex;align-items:flex-end;gap:2px;height:88px;padding:1rem 1rem .5rem;}
.adm-chart .bar{flex:1 1 0;min-width:3px;background:var(--adm-acc);border-radius:2px 2px 0 0;opacity:.85;}
.adm-chart .bar.zero{background:var(--adm-line);}
.adm-chartx{display:flex;justify-content:space-between;padding:0 1rem .8rem;color:var(--adm-mut);font:.72rem/1 ui-monospace,monospace;}
.adm-fn td.step{font-weight:600;}
.adm-fn .barwrap{background:var(--adm-hover);border-radius:4px;height:8px;overflow:hidden;min-width:70px;}
.adm-fn .barwrap i{display:block;height:100%;background:var(--adm-acc);}
.adm-score{display:flex;align-items:center;gap:.5rem;}
.adm-score .track{width:52px;height:6px;border-radius:999px;background:var(--adm-hover);overflow:hidden;}
.adm-score .track i{display:block;height:100%;}
.adm-score .v{font-variant-numeric:tabular-nums;font-size:.8rem;color:var(--adm-mut);}
.adm-b-healthy{background:#e6f4ea;color:#137333;}
.adm-b-attention{background:#fff4e5;color:#b35309;}
.adm-b-risk{background:#fce8e6;color:#c5221f;}
@media(prefers-color-scheme:dark){.adm-b-healthy{background:#0f2a1a;color:#5bd98a;}.adm-b-attention{background:#2e2109;color:#ffb454;}.adm-b-risk{background:#2c1113;color:#ff7a7a;}}
.adm-fac{width:100%;border-collapse:collapse;font-size:.85rem;}
.adm-fac td{padding:.4rem .8rem;border-bottom:1px solid var(--adm-line);}
.adm-fac tr:last-child td{border-bottom:none;}
.adm-fac .p{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.adm-fac .d{color:var(--adm-mut);}
.adm-warn{background:#fff4e5;color:#b35309;border:1px solid #ffd8a8;border-radius:10px;padding:.7rem .9rem;font-size:.85rem;margin:.5rem 0 1rem;}
@media(prefers-color-scheme:dark){.adm-warn{background:#2e2109;color:#ffb454;border-color:#5c4415;}}
.adm-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;align-items:start;}
.adm-chip{display:inline-block;background:var(--adm-hover);border:1px solid var(--adm-line);border-radius:999px;padding:.12rem .5rem;font-size:.75rem;color:var(--adm-mut);margin-right:.25rem;}
</style>`;

/** The console chrome: header, global search, section nav, then the page body. */
export function adminShell(opts: {
  readonly active: string;
  readonly csrf: string;
  readonly env: string;
  readonly searchValue?: string;
  readonly body: string;
}): string {
  const nav = ADMIN_SECTIONS.map(
    (s) => `<a href="${s.href}"${s.key === opts.active ? ' class="on"' : ''}>${esc(s.label)}</a>`,
  ).join('');
  return `${STYLES}<div class="adm">
  <div class="adm-top">
    <h1>Operations console</h1>
    <span class="adm-env">${esc(opts.env)}</span>
    <form class="adm-search" method="get" action="/admin/search" role="search">
      <input type="search" name="q" value="${esc(opts.searchValue ?? '')}" placeholder="Search orgs, users, connections, ids…" aria-label="Search">
      <button class="adm-btn" type="submit">Search</button>
    </form>
  </div>
  <nav class="adm-nav">${nav}</nav>
  ${opts.body}
</div>`;
}

export function adminStatCards(
  cards: readonly { label: string; value: number | string; warn?: boolean }[],
): string {
  return `<div class="adm-cards">${cards
    .map(
      (c) =>
        `<div class="adm-card${c.warn && c.value ? ' warn' : ''}"><div class="n">${esc(
          String(c.value),
        )}</div><div class="l">${esc(c.label)}</div></div>`,
    )
    .join('')}</div>`;
}

export function adminCountCards(counts: AdminCounts): string {
  return adminStatCards([
    { label: 'Organizations', value: counts.tenants },
    { label: 'Users', value: counts.users },
    { label: 'Connections', value: counts.workspaces },
    { label: 'Imports', value: counts.jobs },
    { label: 'Runs', value: counts.runs },
    { label: 'Invitations', value: counts.invitations },
    { label: 'Pending invites', value: counts.pendingInvitations, warn: true },
    { label: 'Running jobs', value: counts.runningJobs },
    { label: 'Failed jobs', value: counts.failedJobs, warn: true },
  ]);
}

export interface AdminColumn<T> {
  /** Sort key; empty string means the column is not sortable. */
  readonly key: string;
  readonly label: string;
  readonly render: (row: T) => string;
  readonly align?: 'right';
}

/** A sortable, paginated table. `query` carries the params to preserve in links. */
export function adminTable<T>(opts: {
  readonly columns: readonly AdminColumn<T>[];
  readonly rows: readonly T[];
  readonly baseUrl: string;
  readonly query: Record<string, string | number | undefined>;
  readonly sort?: string;
  readonly dir?: 'asc' | 'desc';
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly empty?: string;
}): string {
  const head = opts.columns
    .map((c) => {
      const cls = c.align === 'right' ? ' class="r"' : '';
      if (c.key === '') return `<th${cls}>${esc(c.label)}</th>`;
      const active = opts.sort === c.key;
      const nextDir = active && opts.dir === 'desc' ? 'asc' : 'desc';
      const arrow = active ? (opts.dir === 'asc' ? ' ▲' : ' ▼') : '';
      const href = adminQuery(opts.baseUrl, {
        ...opts.query,
        sort: c.key,
        dir: nextDir,
        offset: 0,
      });
      return `<th${cls}><a href="${href}">${esc(c.label)}${arrow}</a></th>`;
    })
    .join('');
  const body =
    opts.rows.length === 0
      ? `<tr><td colspan="${opts.columns.length}"><div class="adm-empty">${esc(
          opts.empty ?? 'Nothing to show.',
        )}</div></td></tr>`
      : opts.rows
          .map(
            (row) =>
              `<tr>${opts.columns
                .map((c) => `<td${c.align === 'right' ? ' class="r"' : ''}>${c.render(row)}</td>`)
                .join('')}</tr>`,
          )
          .join('');
  return `<div class="adm-panel"><div class="adm-tablewrap"><table class="adm-t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>${adminPagination(
    opts,
  )}`;
}

function adminPagination(opts: {
  readonly baseUrl: string;
  readonly query: Record<string, string | number | undefined>;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}): string {
  const start = opts.total === 0 ? 0 : opts.offset + 1;
  const end = Math.min(opts.offset + opts.limit, opts.total);
  const prevOffset = Math.max(0, opts.offset - opts.limit);
  const hasPrev = opts.offset > 0;
  const hasNext = opts.offset + opts.limit < opts.total;
  const prev = hasPrev
    ? `<a href="${adminQuery(opts.baseUrl, { ...opts.query, offset: prevOffset })}">← Prev</a>`
    : `<span class="off">← Prev</span>`;
  const next = hasNext
    ? `<a href="${adminQuery(opts.baseUrl, { ...opts.query, offset: opts.offset + opts.limit })}">Next →</a>`
    : `<span class="off">Next →</span>`;
  return `<div class="adm-pg"><span>${start}–${end} of ${opts.total}</span>${prev}${next}</div>`;
}

/** GET filter bar: a search box plus optional status <select>s. */
export function adminFilterBar(opts: {
  readonly baseUrl: string;
  readonly q?: string;
  readonly searchPlaceholder?: string;
  readonly selects?: readonly {
    name: string;
    value?: string;
    label: string;
    options: readonly { value: string; label: string }[];
  }[];
  readonly hidden?: Record<string, string | undefined>;
}): string {
  const hidden = Object.entries(opts.hidden ?? {})
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`)
    .join('');
  const selects = (opts.selects ?? [])
    .map((s) => {
      const options = [{ value: '', label: `All ${s.label}` }, ...s.options]
        .map(
          (o) =>
            `<option value="${esc(o.value)}"${o.value === (s.value ?? '') ? ' selected' : ''}>${esc(
              o.label,
            )}</option>`,
        )
        .join('');
      return `<select name="${esc(s.name)}" aria-label="${esc(s.label)}">${options}</select>`;
    })
    .join('');
  return `<form class="adm-bar" method="get" action="${esc(opts.baseUrl)}">${hidden}
    <input type="search" name="q" value="${esc(opts.q ?? '')}" placeholder="${esc(
      opts.searchPlaceholder ?? 'Search…',
    )}">
    ${selects}
    <button type="submit">Filter</button>
    ${opts.q || (opts.selects ?? []).some((s) => s.value) ? `<a class="clr" href="${esc(opts.baseUrl)}">Clear</a>` : ''}
  </form>`;
}

const BADGE_KIND: Record<string, string> = {
  succeeded: 'adm-b-ok',
  ready: 'adm-b-ok',
  accepted: 'adm-b-ok',
  running: 'adm-b-info',
  queued: 'adm-b-info',
  pending: 'adm-b-warn',
  failed: 'adm-b-err',
  revoked: 'adm-b-mut',
  owner: 'adm-b-info',
  admin: 'adm-b-info',
  member: 'adm-b-mut',
};

export function adminBadge(text: string): string {
  const kind = BADGE_KIND[text.toLowerCase()] ?? 'adm-b-mut';
  return `<span class="adm-badge ${kind}">${esc(text)}</span>`;
}

/** Truncated, monospace id with a copy-friendly full title. */
export function adminId(id: string, len = 8): string {
  return `<span class="adm-mono" title="${esc(id)}">${esc(id.slice(0, len))}</span>`;
}

export function adminKvPanel(entries: readonly [string, string][]): string {
  return `<div class="adm-panel"><dl class="adm-kv">${entries
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`)
    .join('')}</dl></div>`;
}

// ---------------------------------------------------------------------------
// Customer database views (P4.5). Still pure functions over already-fetched
// data, still zero client JavaScript: charts are CSS boxes, filters are GET
// forms, and every action is a CSRF-protected POST.
// ---------------------------------------------------------------------------

/** Metric card with an optional secondary line ('12 this week'). */
export function adminMetrics(
  cards: readonly { label: string; value: number | string; sub?: string; warn?: boolean }[],
): string {
  return `<div class="adm-cards">${cards
    .map(
      (c) =>
        `<div class="adm-card${c.warn && c.value ? ' warn' : ''}"><div class="n">${esc(
          String(c.value),
        )}</div><div class="l">${esc(c.label)}</div>${
          c.sub ? `<div class="s">${esc(c.sub)}</div>` : ''
        }</div>`,
    )
    .join('')}</div>`;
}

/**
 * A daily bar chart as plain CSS boxes. Heights are percentages of the series
 * maximum, so the shape is honest even though there is no axis; the first and
 * last dates are labelled underneath and the peak is stated, which is what an
 * operator actually reads off a sparkline.
 */
export function adminBarChart(
  series: readonly { readonly date: string; readonly value: number }[],
  emptyLabel = 'No activity in this window.',
): string {
  if (series.length === 0)
    return `<div class="adm-panel"><div class="adm-empty">${esc(emptyLabel)}</div></div>`;
  const max = Math.max(...series.map((p) => p.value), 1);
  const bars = series
    .map((p) => {
      const pct = Math.round((p.value / max) * 100);
      const cls = p.value === 0 ? 'bar zero' : 'bar';
      return `<div class="${cls}" style="height:${Math.max(pct, 2)}%" title="${esc(p.date)}: ${p.value}"></div>`;
    })
    .join('');
  const first = series[0]?.date ?? '';
  const last = series[series.length - 1]?.date ?? '';
  return `<div class="adm-panel"><div class="adm-chart">${bars}</div>
    <div class="adm-chartx"><span>${esc(first)}</span><span>peak ${max}</span><span>${esc(last)}</span></div></div>`;
}

const HEALTH_CLASS: Record<string, string> = {
  healthy: 'adm-b-healthy',
  'needs-attention': 'adm-b-attention',
  inactive: 'adm-b-mut',
  'churn-risk': 'adm-b-risk',
  active: 'adm-b-healthy',
  new: 'adm-b-info',
  onboarding: 'adm-b-warn',
};

/** Health band or lifecycle status, colored by meaning rather than by string. */
export function adminHealthBadge(value: string, label: string): string {
  const cls = HEALTH_CLASS[value] ?? 'adm-b-mut';
  return `<span class="adm-badge ${cls}">${esc(label)}</span>`;
}

/** Score with its bar. Colour follows the same thresholds as the band. */
export function adminScore(score: number): string {
  const color = score >= 65 ? '#137333' : score >= 40 ? '#b35309' : '#c5221f';
  return `<span class="adm-score"><span class="track"><i style="width:${Math.max(
    0,
    Math.min(100, score),
  )}%;background:${color}"></i></span><span class="v">${score}</span></span>`;
}

/**
 * The score, itemized. Rendering the rules rather than just the number is the
 * point: an operator can see exactly why someone is at risk, and disagree with
 * the rule rather than distrust the whole score.
 */
export function adminHealthBreakdown(
  factors: readonly { label: string; points: number; max: number; detail: string }[],
  score: number,
): string {
  const rows = factors
    .map(
      (f) =>
        `<tr><td>${esc(f.label)}</td><td class="d">${esc(f.detail)}</td><td class="p">${f.points} / ${f.max}</td></tr>`,
    )
    .join('');
  return `<div class="adm-panel"><table class="adm-fac"><tbody>${rows}
    <tr><td><strong>Score</strong></td><td class="d">Deterministic; identical inputs always give this number</td><td class="p"><strong>${score} / 100</strong></td></tr>
  </tbody></table></div>`;
}

/** The onboarding funnel: counts, conversion, drop-off, and time to next step. */
export function adminFunnelTable(
  steps: readonly {
    key: string;
    label: string;
    reached: number;
    avgToNextMs: number | null;
    fromState: boolean;
  }[],
  fmt: {
    conversion: (i: number) => number | null;
    dropOff: (i: number) => number | null;
    duration: (ms: number | null) => string;
  },
): string {
  const first = steps[0]?.reached ?? 0;
  const body = steps
    .map((step, i) => {
      const conv = fmt.conversion(i);
      const drop = fmt.dropOff(i);
      const width = first === 0 ? 0 : Math.round((step.reached / first) * 100);
      return `<tr>
        <td class="step">${i + 1}. ${esc(step.label)}${
          step.fromState
            ? ' <span class="adm-chip" title="Reached is read from current state; this organization predates the activity log, so the timing is not recorded">state</span>'
            : ''
        }</td>
        <td class="r">${step.reached}</td>
        <td><div class="barwrap"><i style="width:${width}%"></i></div></td>
        <td class="r">${conv === null ? '—' : `${conv}%`}</td>
        <td class="r">${drop === null ? '—' : `${drop}%`}</td>
        <td class="r">${esc(fmt.duration(step.avgToNextMs))}</td>
      </tr>`;
    })
    .join('');
  return `<div class="adm-panel"><div class="adm-tablewrap"><table class="adm-t adm-fn">
    <thead><tr><th>Step</th><th class="r">Orgs</th><th></th><th class="r">Conversion</th><th class="r">Drop-off</th><th class="r">Avg to next</th></tr></thead>
    <tbody>${body}</tbody></table></div></div>`;
}

/**
 * Human sentence for one activity event. Reads as "who did what", using the
 * organization name when there is no acting user (imports and analyses run
 * detached from any session, so attributing them to a person would be a guess).
 */
export function describeEvent(row: {
  type: string;
  userEmail: string | null;
  orgName: string | null;
  workspaceName: string | null;
  fields: Readonly<Record<string, unknown>>;
}): string {
  const who = row.userEmail ?? row.orgName ?? 'An organization';
  const where = row.workspaceName ? ` in ${row.workspaceName}` : '';
  const provider = typeof row.fields['provider'] === 'string' ? row.fields['provider'] : null;
  const ok = row.fields['ok'];
  switch (row.type) {
    case 'org.created':
      return `${row.orgName ?? 'A new organization'} was created`;
    case 'org.renamed':
      return `${who} renamed the organization`;
    case 'user.created':
      return `${who} joined as ${String(row.fields['role'] ?? 'member')}`;
    case 'session.started':
      return `${who} signed in`;
    case 'workspace.connected':
      return ok === false
        ? `${who} failed to connect ${provider ?? 'an integration'} (${String(row.fields['errorClass'] ?? 'error')})`
        : `${who} connected ${provider ?? 'an integration'}`;
    case 'workspace.named':
      return `${who} named a monitoring workspace${where}`;
    case 'workspace.ready':
      return `Monitoring workspace${where} is fully configured`;
    case 'scope.selected':
      return `${who} selected a scope${where}`;
    case 'statuses.mapped':
      return `${who} mapped ${String(row.fields['mapped'] ?? '')} statuses${where}`;
    case 'actors.mapped':
      return `${who} mapped ${String(row.fields['mappedToRoles'] ?? '')} people to roles${where}`;
    case 'assumptions.set':
      return `${who} configured salaries${where}`;
    case 'analysis.started':
      return `${who} started an analysis${where}`;
    case 'analysis.completed':
      return ok === false
        ? `Analysis failed${where} (${String(row.fields['errorClass'] ?? 'error')})`
        : `Analysis completed${where}`;
    case 'import.finished':
      return row.fields['status'] === 'failed'
        ? `Import failed${where} (${String(row.fields['errorClass'] ?? 'error')})`
        : `Import succeeded${where}`;
    case 'report.viewed':
      return row.fields['firstView'] === true
        ? `${who} viewed a report for the first time`
        : `${who} viewed a report`;
    case 'member.invited':
      return `${who} invited a ${String(row.fields['role'] ?? 'member')}`;
    case 'member.joined':
      return `A ${String(row.fields['role'] ?? 'member')} accepted an invitation`;
    case 'member.role-changed':
      return `${who} changed a member's role to ${String(row.fields['role'] ?? '')}`;
    case 'member.removed':
      return `${who} removed a member`;
    case 'invitation.revoked':
      return `${who} revoked an invitation`;
    case 'workspace.member-added':
      return `${who} granted a member access${where}`;
    case 'workspace.member-removed':
      return `${who} revoked a member's access${where}`;
    case 'data.deleted':
      return `${who} deleted ${String(row.fields['scope'] ?? 'data')}`;
    default:
      return `${who}: ${row.type}`;
  }
}

/** Newest-first activity feed. */
export function adminActivityList(
  rows: readonly {
    id: string;
    at: string;
    type: string;
    tenantId: string;
    orgName: string | null;
    userEmail: string | null;
    workspaceName: string | null;
    fields: Readonly<Record<string, unknown>>;
  }[],
): string {
  if (rows.length === 0)
    return `<div class="adm-panel"><div class="adm-empty">No activity recorded yet.</div></div>`;
  return `<div class="adm-panel"><ul class="adm-tl">${rows
    .map(
      (r) =>
        `<li><div class="t">${esc(describeEvent(r))}</div><div class="d">${esc(
          r.at.slice(0, 16).replace('T', ' '),
        )} · <a href="/admin/tenants/${encodeURIComponent(r.tenantId)}">${esc(
          r.orgName ?? r.tenantId.slice(0, 8),
        )}</a> · ${esc(r.type)}</div></li>`,
    )
    .join('')}</ul></div>`;
}

/** Banner shown when a view was computed over a bounded scan. */
export function adminTruncationNotice(cap: number): string {
  return `<div class="adm-warn">Showing the ${cap.toLocaleString('en-US')} most recent matching records. Health scores are computed per request, so this view is capped rather than scanning the whole table. Narrow the filters for an exact count.</div>`;
}

export function adminAuditDetail(row: AdminAuditRow): string {
  if (!row.detail) return '<span class="adm-mono">—</span>';
  const parts = Object.entries(row.detail).map(
    ([k, v]) => `${esc(k)}=${esc(typeof v === 'string' ? v : JSON.stringify(v))}`,
  );
  return `<span class="adm-mono">${parts.join(' ')}</span>`;
}
