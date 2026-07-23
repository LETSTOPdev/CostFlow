import type { StageKind } from '@costflow/domain';
import { transformJira, type JiraMapping } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import { buildPseudonymizationContext } from './crypto';
import { renderReportBody } from './report-view';
import type { AssumptionSet } from '@costflow/domain';

/**
 * Interactive Demo Mode. A visitor who will not connect Jira on the first
 * visit still gets the full CostFlow experience: a *randomly generated, but
 * realistic* company is fed through the REAL engine (transformJira →
 * runAnalysis → renderReportBody), exactly like production. Nothing here is
 * hardcoded report HTML.
 *
 * Determinism: everything derives from a numeric `seed`, so a shared demo link
 * reproduces the same company, while a fresh visit (new random seed) produces a
 * different company, team, costs, bottlenecks, and recommendations.
 */

/** mulberry32 — small deterministic PRNG. Web layer only; never the engine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]!;
const int = (r: () => number, lo: number, hi: number): number =>
  lo + Math.floor(r() * (hi - lo + 1));

/** Analysis anchor: fixed so a shared demo link is fully reproducible. */
const NOW = '2026-07-23T00:00:00.000Z';
const iso = (dateOnly: string): string => `${dateOnly}T00:00:00.000+0000`;
function dayOffset(daysBeforeNow: number): string {
  const d = new Date(Date.UTC(2026, 6, 23));
  d.setUTCDate(d.getUTCDate() - daysBeforeNow);
  return d.toISOString().slice(0, 10);
}

interface Industry {
  readonly key: string;
  readonly label: string;
  readonly companies: readonly string[];
  readonly projects: readonly [string, string][]; // [name, key]
  readonly statuses: readonly { name: string; kind: StageKind }[];
  readonly roles: readonly { role: string; rate: string }[];
  readonly firstNames: readonly string[];
  readonly lastNames: readonly string[];
  readonly summaries: readonly string[];
  readonly currency: string;
  readonly aging: number; // threshold days
}

const NAMES_A = [
  'Alex',
  'Maria',
  'James',
  'Priya',
  'Chen',
  'Sofia',
  'Omar',
  'Lena',
  'Noah',
  'Yuki',
  'David',
  'Amara',
  'Tomas',
  'Nadia',
  'Liam',
  'Fatima',
] as const;
const NAMES_B = [
  'Okafor',
  'Nguyen',
  'Silva',
  'Kim',
  'Patel',
  'Rossi',
  'Haddad',
  'Novak',
  'Andersson',
  'Cohen',
  'Reyes',
  'Ivanov',
  'Costa',
  'Mensah',
  'Bauer',
  'Tanaka',
] as const;

const INDUSTRIES: readonly Industry[] = [
  {
    key: 'saas',
    label: 'SaaS startup',
    companies: ['Northwind Labs', 'Cadence', 'Pulsegrid', 'Loop', 'Beacon Cloud', 'Trailhead'],
    projects: [
      ['Platform', 'PLAT'],
      ['Core API', 'API'],
      ['Growth', 'GROW'],
    ],
    statuses: [
      { name: 'To Do', kind: 'queue' },
      { name: 'In Progress', kind: 'active' },
      { name: 'In Review', kind: 'review' },
      { name: 'Blocked', kind: 'blocked' },
      { name: 'Done', kind: 'done' },
    ],
    roles: [
      { role: 'Engineering', rate: '125' },
      { role: 'Product', rate: '135' },
      { role: 'QA', rate: '95' },
      { role: 'Design', rate: '115' },
    ],
    firstNames: NAMES_A,
    lastNames: NAMES_B,
    summaries: [
      'Migrate billing service to the new metering API',
      'Fix checkout 500 error on Safari',
      'Add SSO (SAML) for enterprise tenants',
      'Reduce cold-start latency on the auth service',
      'Rework onboarding funnel step 2',
      'Investigate flaky webhook deliveries',
      'Upgrade Postgres to 16 and re-index',
      'Ship usage-based pricing to GA',
      'Instrument activation funnel events',
      'Refactor feature-flag evaluation',
    ],
    currency: 'USD',
    aging: 14,
  },
  {
    key: 'agency',
    label: 'marketing agency',
    companies: ['Brightside', 'Kite & Co', 'Foundry Creative', 'Northlight', 'Aster', 'Meridian'],
    projects: [
      ['Client Delivery', 'CD'],
      ['Campaigns', 'CAMP'],
      ['Brand', 'BR'],
    ],
    statuses: [
      { name: 'Backlog', kind: 'queue' },
      { name: 'Briefing', kind: 'queue' },
      { name: 'In Production', kind: 'active' },
      { name: 'Client Review', kind: 'review' },
      { name: 'On Hold', kind: 'blocked' },
      { name: 'Approved', kind: 'done' },
    ],
    roles: [
      { role: 'Creative', rate: '105' },
      { role: 'Strategy', rate: '140' },
      { role: 'Account', rate: '110' },
      { role: 'Production', rate: '85' },
    ],
    firstNames: NAMES_A,
    lastNames: NAMES_B,
    summaries: [
      'Q3 launch campaign: hero video edit',
      'Rework landing page for Acme rebrand',
      'Client feedback round 3 on social kit',
      'Photography shoot deliverables',
      'Paid search account restructure',
      'Email nurture sequence copy',
      'Brand guidelines v2 rollout',
      'Influencer contract deliverables',
      'Website CMS migration',
      'Event booth creative package',
    ],
    currency: 'USD',
    aging: 10,
  },
  {
    key: 'enterprise',
    label: 'enterprise software org',
    companies: [
      'Halcyon Systems',
      'Vertex',
      'Ironwood',
      'Sable Technologies',
      'Continuum',
      'Argon',
    ],
    projects: [
      ['Modernization', 'MOD'],
      ['Data Platform', 'DP'],
      ['Integrations', 'INT'],
    ],
    statuses: [
      { name: 'Open', kind: 'queue' },
      { name: 'Analysis', kind: 'queue' },
      { name: 'Development', kind: 'active' },
      { name: 'Code Review', kind: 'review' },
      { name: 'QA', kind: 'review' },
      { name: 'On Hold', kind: 'blocked' },
      { name: 'Released', kind: 'done' },
    ],
    roles: [
      { role: 'Backend', rate: '135' },
      { role: 'Platform', rate: '150' },
      { role: 'QA', rate: '100' },
      { role: 'Architecture', rate: '175' },
    ],
    firstNames: NAMES_A,
    lastNames: NAMES_B,
    summaries: [
      'Decompose the monolith order module',
      'Harden SSO token refresh across regions',
      'Migrate ETL jobs to the new scheduler',
      'Remediate CVE in the reporting service',
      'Add multi-region failover to the API gateway',
      'Deprecate the legacy SOAP endpoints',
      'Data warehouse partition strategy',
      'Audit log retention compliance work',
      'Performance regression in search',
      'Blue/green deploy for the billing cluster',
    ],
    currency: 'USD',
    aging: 21,
  },
  {
    key: 'construction',
    label: 'construction firm',
    companies: [
      'Keystone Build',
      'Granite Works',
      'Summit Contractors',
      'Ironclad',
      'Meridian Build',
    ],
    projects: [
      ['Tower A', 'TWRA'],
      ['Site Ops', 'SITE'],
      ['Fit-out', 'FIT'],
    ],
    statuses: [
      { name: 'Planned', kind: 'queue' },
      { name: 'Permitting', kind: 'queue' },
      { name: 'In Progress', kind: 'active' },
      { name: 'Inspection', kind: 'review' },
      { name: 'Blocked', kind: 'blocked' },
      { name: 'Complete', kind: 'done' },
    ],
    roles: [
      { role: 'Site', rate: '95' },
      { role: 'Engineering', rate: '130' },
      { role: 'Compliance', rate: '120' },
      { role: 'Procurement', rate: '90' },
    ],
    firstNames: NAMES_A,
    lastNames: NAMES_B,
    summaries: [
      'Pour level 4 slab',
      'HVAC rough-in inspection',
      'Steel delivery from supplier',
      'Fire-safety permit approval',
      'Electrical panel installation',
      'Facade cladding sign-off',
      'Site drainage remediation',
      'Elevator commissioning',
      'Structural inspection sign-off',
      'Punch-list closeout: floor 3',
    ],
    currency: 'USD',
    aging: 21,
  },
  {
    key: 'healthcare',
    label: 'healthcare provider',
    companies: ['Cedar Health', 'Meadowbrook', 'Northgate Medical', 'Vitalis', 'Bayview Care'],
    projects: [
      ['Patient Systems', 'PS'],
      ['Compliance', 'COMP'],
      ['Operations', 'OPS'],
    ],
    statuses: [
      { name: 'Intake', kind: 'queue' },
      { name: 'Assessment', kind: 'queue' },
      { name: 'In Progress', kind: 'active' },
      { name: 'Compliance Review', kind: 'review' },
      { name: 'Blocked', kind: 'blocked' },
      { name: 'Resolved', kind: 'done' },
    ],
    roles: [
      { role: 'Clinical Systems', rate: '140' },
      { role: 'Compliance', rate: '150' },
      { role: 'IT Operations', rate: '110' },
      { role: 'Data', rate: '120' },
    ],
    firstNames: NAMES_A,
    lastNames: NAMES_B,
    summaries: [
      'EHR interface upgrade for lab results',
      'HIPAA access-audit remediation',
      'Patient portal appointment sync',
      'Onboard new imaging device integration',
      'De-identify analytics data pipeline',
      'Incident review: scheduling outage',
      'Migrate legacy records to the new EHR',
      'Consent-form workflow digitization',
      'Pharmacy formulary update',
      'Telehealth capacity scaling',
    ],
    currency: 'USD',
    aging: 14,
  },
  {
    key: 'manufacturing',
    label: 'manufacturing company',
    companies: ['Forge Dynamics', 'Axle Works', 'Precision Cast', 'Meridian Mfg', 'Ironhill'],
    projects: [
      ['Line Ops', 'LINE'],
      ['Tooling', 'TOOL'],
      ['Quality', 'QUAL'],
    ],
    statuses: [
      { name: 'Queued', kind: 'queue' },
      { name: 'Setup', kind: 'active' },
      { name: 'Running', kind: 'active' },
      { name: 'QC', kind: 'review' },
      { name: 'Rework', kind: 'blocked' },
      { name: 'Shipped', kind: 'done' },
    ],
    roles: [
      { role: 'Production', rate: '85' },
      { role: 'Quality', rate: '105' },
      { role: 'Maintenance', rate: '95' },
      { role: 'Engineering', rate: '130' },
    ],
    firstNames: NAMES_A,
    lastNames: NAMES_B,
    summaries: [
      'Retool line 3 for the new SKU',
      'Investigate QC failure on batch 4471',
      'Preventive maintenance: press #2',
      'Supplier delay on bearings',
      'Calibrate CNC tolerances',
      'Rework defective housing lot',
      'Line changeover time reduction',
      'Scrap-rate root-cause analysis',
      'Safety guarding retrofit',
      'Ship order to distribution',
    ],
    currency: 'USD',
    aging: 10,
  },
  {
    key: 'finance',
    label: 'finance team',
    companies: ['Sterling Capital', 'Aldergate', 'Brookfield Finance', 'Vantage', 'Cornerstone'],
    projects: [
      ['Close & Report', 'CLOSE'],
      ['Controls', 'CTRL'],
      ['FP&A', 'FPA'],
    ],
    statuses: [
      { name: 'New', kind: 'queue' },
      { name: 'Review', kind: 'queue' },
      { name: 'In Progress', kind: 'active' },
      { name: 'Approval', kind: 'review' },
      { name: 'Reconciliation', kind: 'blocked' },
      { name: 'Closed', kind: 'done' },
    ],
    roles: [
      { role: 'Accounting', rate: '110' },
      { role: 'Controls', rate: '135' },
      { role: 'Analysis', rate: '125' },
      { role: 'Treasury', rate: '140' },
    ],
    firstNames: NAMES_A,
    lastNames: NAMES_B,
    summaries: [
      'Q2 month-end close: intercompany',
      'Reconcile the revenue subledger',
      'SOX control testing remediation',
      'Automate the flux commentary report',
      'Vendor payment run approval',
      'Restate deferred revenue schedule',
      'Audit PBC list preparation',
      'Cash-flow forecast model refresh',
      'Tax provision true-up',
      'Board deck financial exhibits',
    ],
    currency: 'USD',
    aging: 7,
  },
  {
    key: 'ecommerce',
    label: 'e-commerce company',
    companies: ['Harborline', 'Craftly', 'Vireo', 'Marketside', 'Bloom & Co'],
    projects: [
      ['Storefront', 'SHOP'],
      ['Fulfillment', 'FUL'],
      ['Growth', 'GRW'],
    ],
    statuses: [
      { name: 'Backlog', kind: 'queue' },
      { name: 'In Progress', kind: 'active' },
      { name: 'Design Review', kind: 'review' },
      { name: 'QA', kind: 'review' },
      { name: 'Blocked', kind: 'blocked' },
      { name: 'Live', kind: 'done' },
    ],
    roles: [
      { role: 'Engineering', rate: '120' },
      { role: 'Merchandising', rate: '100' },
      { role: 'Design', rate: '110' },
      { role: 'Ops', rate: '90' },
    ],
    firstNames: NAMES_A,
    lastNames: NAMES_B,
    summaries: [
      'Fix cart abandonment on mobile',
      'Peak-season checkout load testing',
      'Add buy-now-pay-later at checkout',
      'Warehouse inventory sync latency',
      'Rework the PDP image gallery',
      'Fraud-review queue automation',
      'Returns portal self-service',
      'Search relevance tuning',
      'Promo-code engine edge cases',
      'Ship the new loyalty program',
    ],
    currency: 'USD',
    aging: 10,
  },
];

const WORK_TYPES = ['Epic', 'Story', 'Bug', 'Task'] as const;

export interface DemoCompany {
  readonly seed: number;
  readonly industry: string;
  readonly companyName: string;
  readonly projectName: string;
  readonly projectKey: string;
  readonly issueCount: number;
  readonly teamSize: number;
  readonly reportBody: string;
}

/** Generate the company, feed the REAL engine, and render the report. */
export function renderDemoCompany(seed: number): DemoCompany {
  const r = rng(seed);
  r(); // warm up mulberry32 so adjacent/small seeds decorrelate
  r();
  r();
  const ind = pick(r, INDUSTRIES);
  const companyName = pick(r, ind.companies);
  const [projectName, projectKey] = pick(r, ind.projects);
  const teamSize = int(r, 6, 14);
  const team = Array.from(
    { length: teamSize },
    () => `${pick(r, ind.firstNames)} ${pick(r, ind.lastNames)}`,
  );
  const nonTerminal = ind.statuses.filter((s) => s.kind !== 'done' && s.kind !== 'abandoned');
  const queueStatuses = ind.statuses.filter((s) => s.kind === 'queue');
  const doneStatus = ind.statuses.find((s) => s.kind === 'done')!;
  const n = int(r, 60, 160);

  const issues: unknown[] = [];
  for (let i = 1; i <= n; i++) {
    const bucket = r();
    // Distribution engineered to surface real, varied friction.
    let status: { name: string; kind: StageKind };
    let createdDaysAgo: number;
    let updatedDaysAgo: number;
    let due: string | null = null;
    if (bucket < 0.35) {
      // aging: sitting in a non-terminal stage, untouched a long time
      status = pick(r, nonTerminal);
      createdDaysAgo = int(r, ind.aging + 20, 160);
      updatedDaysAgo = int(r, ind.aging + 5, createdDaysAgo);
    } else if (bucket < 0.55) {
      // queued: currently in a queue stage
      status = pick(r, queueStatuses.length ? queueStatuses : nonTerminal);
      createdDaysAgo = int(r, 10, 90);
      updatedDaysAgo = int(r, 3, createdDaysAgo);
    } else if (bucket < 0.72) {
      // overdue: still open, due date in the past
      status = pick(r, nonTerminal);
      createdDaysAgo = int(r, 15, 120);
      updatedDaysAgo = int(r, 1, 12);
      due = dayOffset(int(r, 2, 40));
    } else {
      // completed work
      status = doneStatus;
      createdDaysAgo = int(r, 20, 150);
      updatedDaysAgo = int(r, 1, 20);
      if (r() < 0.4) due = dayOffset(int(r, -20, 30));
    }
    const created = dayOffset(createdDaysAgo);
    const updated = dayOffset(Math.min(updatedDaysAgo, createdDaysAgo));
    const assignee = pick(r, team);
    const type = pick(r, WORK_TYPES);
    const issue: {
      key: string;
      fields: Record<string, unknown>;
      changelog?: { total: number; histories: unknown[] };
    } = {
      key: `${projectKey}-${i}`,
      fields: {
        summary: `${type}: ${pick(r, ind.summaries)}`,
        status: { name: status.name },
        assignee: { displayName: assignee },
        created: iso(created),
        updated: iso(updated),
        duedate: due,
      },
    };
    // A realistic transition path: arrival → (a queue) → current, dated between
    // created and updated, all through mapped statuses (no J3 error).
    if (status.kind !== 'queue' && r() < 0.7) {
      const via = pick(
        r,
        ind.statuses.filter((s) => s.name !== status.name),
      );
      const at = dayOffset(int(r, updatedDaysAgo, createdDaysAgo));
      issue.changelog = {
        total: 1,
        histories: [
          {
            created: iso(at),
            items: [{ field: 'status', fromString: via.name, toString: status.name }],
          },
        ],
      };
    }
    issues.push(issue);
  }

  const pages: string[] = [];
  for (let p = 0; p < issues.length; p += 100) {
    pages.push(
      JSON.stringify({ startAt: p, maxResults: 100, total: n, issues: issues.slice(p, p + 100) }),
    );
  }

  // Mapping: explicit (we own the workflow) + role assignment for each teammate.
  const statusMap: Record<string, StageKind> = {};
  for (const s of ind.statuses) statusMap[s.name] = s.kind;
  const actorRoleMap: Record<string, string> = {};
  team.forEach((name, idx) => {
    actorRoleMap[name] = ind.roles[idx % ind.roles.length]!.role;
  });
  const mapping: JiraMapping = {
    id: `demo-${seed}`,
    version: '1',
    statusMap,
    actorRoleMap,
  };

  // Assumptions: fully customer-accepted so the demo report is PRICED (not a
  // wall of unpriced items), with realistic per-industry rate cards.
  const assumptions: AssumptionSet = {
    id: `demo-${seed}`,
    version: '1',
    currency: ind.currency,
    rates: ind.roles.map((rr) => ({
      roleRef: rr.role,
      hourlyRate: rr.rate,
      provenance: 'customer-accepted',
    })),
    defaultRate: { hourlyRate: '95', provenance: 'customer-accepted' },
    parameters: {
      agingThresholdDays: { value: ind.aging, provenance: 'customer-accepted' },
      attentionHoursPerDay: {
        range: { low: '0.2', expected: '0.5', high: '1' },
        provenance: 'customer-accepted',
      },
      queueWaitAttentionHoursPerDay: {
        range: { low: '0.1', expected: '0.25', high: '0.5' },
        provenance: 'customer-accepted',
      },
      overdueAttentionHoursPerDay: {
        range: { low: '0.25', expected: '0.6', high: '1.25' },
        provenance: 'customer-accepted',
      },
    },
  };

  const pseudonymization = buildPseudonymizationContext(`demo-${seed}`, `demo-salt-${seed}`);
  const batch = transformJira({
    batchId: `demo-batch-${seed}`,
    searchPages: pages,
    supplementaryChangelogs: {},
    mapping,
    importedAt: NOW,
    pseudonymization,
  });
  const run = runAnalysis({ runId: `demo-${seed}`, now: NOW, batch, assumptions, mode: 'report' });
  const reportBody = renderReportBody(run, { runId: `demo-${seed}` });

  return {
    seed,
    industry: ind.label,
    companyName,
    projectName,
    projectKey,
    issueCount: n,
    teamSize,
    reportBody,
  };
}

/** A fresh random seed for a new demo (impure web layer — never the engine). */
export function randomDemoSeed(): number {
  return (Math.floor(Math.random() * 2_147_483_646) + 1) >>> 0;
}
