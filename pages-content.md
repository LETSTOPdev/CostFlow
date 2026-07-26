# CostFlow Pages - Detailed Content & UI Elements

Complete breakdown of all pages including buttons, forms, fields, sections, and interactive elements.

---

## 1. LANDING PAGE (/) ✅ redesigned — light theme, calm motion

### Route Details
- **URL**: `/`
- **Authentication**: None (public)
- **Type**: GET
- **Redirect Logic**: 
  - Logged-out visitors → Landing page
  - Logged-in managers → Next step in onboarding or `/runs`
  - Logged-in non-managers (members) → `/runs`

### Main Sections

#### Hero Section
- **Title**: "See what delays in Jira or ClickUp are costing you in dollars."
- **Subtitle**: "Connect Jira or ClickUp and get a ranked cost report in about a minute. Every figure traces back to its formula."
- **Aurora Background**: Animated gradient background
- **Call-to-Action Badge**: "Try the live demo for free during beta. No signup required. →" (links to `/try`)
- **Primary Buttons**:
  - "Get started free" (links to `/signup`)
  - "Try a live demo" (ghost style, links to `/try`)
- **Trust Line**:
  - ✓ No credit card
  - ✓ Read-only
  - ✓ Ready in ~1 minute

#### Product Mockup Section
Faux CostFlow app window showing:
- **Sidebar Navigation**:
  - Home
  - Reports (active/highlighted)
  - Runs
  - Organization
  - Settings
  - Avatar: "O" (Operations workspace)
  - Workspace name: "Operations (OPS)"

- **Main Report Display**:
  - Eyebrow: "Friction report"
  - Large metric: "$2,229" (total priced friction)
  - Range: "1,114 to 4,458 expected range"
  - Chips: "5 priced", "0 unpriced", "USD", "Jul 20"
  - Sparkline chart (area chart with gradient)
  - **Ranked Frictions List**:
    - #1: Queue wait in To Do - $1,062 (Tier C) - 100% bar
    - #2: Overdue exposure in To Do - $342 (Tier A) - 42% bar
    - #3: Aging in In Review - $297 (Tier B) - 34% bar

#### "How It Works" Section (3-Step Process)
- **Step 01 - Connect**
  - Visualization: Mini connect form with:
    - Workspace field (e.g., "Jira or ClickUp")
    - API token field (masked: ••••••••••••)
    - "Validate & connect" button
  - Description: "Pick Jira or ClickUp and paste a read-only API token. We never write to your board."

- **Step 02 - Map & Confirm**
  - Visualization: Status mapping:
    - In Progress → "active" (tag)
    - Waiting → "queue" (tag)
    - Blocked → "stalled" (warning tag)
  - Description: "Match statuses to stages and confirm rates. Nothing is priced on a guess you didn't approve."

- **Step 03 - Get Your Report**
  - Visualization: Dollar amount ($2,229) with 3 bar charts
  - Description: "Ranked frictions with cost ranges, confidence tiers, and a formula drill-down for every figure."

#### "Defensible by Design" Section
- **Kicker**: "Defensible by design"
- **Heading**: "Every number opens up into exactly how it was computed."
- **Description**: "Every figure expands into its formula, inputs, and assumptions. Anything unconfirmed stays unpriced. We never guess."
- **Trace Card Visualization**:
  - Title: "#1 Queue wait in To Do" with Tier C badge
  - Amount: "$531 to $2,124 (expected ~$1,062)"
  - Expandable section: "How this number was computed" (collapsible)
  - Details when expanded:
    - Formula: `wait_days × rate × attention/day`
    - Items: **18 work items, 1,536 item-hours waiting**
    - Rate: **$95/h default (customer-accepted)**

#### Mid-Page CTA
- **Button**: "See what it's costing my team"
- **Fine print**: "Your first report takes about a minute. No credit card. Read-only access."

#### Trust Section
- **Heading**: "Built to be trusted"
- **Trust Points** (with icons):
  - People icon: Trust detail about team handling
  - Lock icon: Trust detail about security

#### Footer
- **Brand Lockup**: Theme-aware CostFlow logo (responsive)
- **Links**: Navigation and support information

---

## 2. DEMO PAGE (/demo) ✅ verified live — light theme, on-brand

### Route Details
- **URL**: `/demo`
- **Authentication**: None (public)
- **Type**: GET
- **Description**: Public sample report built from demo Jira data

### Content

#### Info Banner
- **Text**: "This is a **sample report** built from demo data. [Sign in] to run one on your own Jira or ClickUp."
- **Background**: Info-level styling

#### Full Report Body
- Rendered from `DEMO_RUN_JSON` (committed demo snapshot)
- Displays complete report layout (see Reports page below)
- All interactive elements are read-only

#### Call-to-Action Band
- **Section Title**: "Ready to see your own?"
- **Description**: "Connect Jira or ClickUp and get a report like this for your own team in about a minute. Free while in beta."
- **Button**: "Get started free" (links to `/login`)

---

## 3. TRY PAGE (/try) ✅ verified live — light theme, on-brand

### Route Details
- **URL**: `/try`
- **Authentication**: None (public)
- **Type**: GET
- **Description**: Interactive try-before-you-buy demo page

### Content
- Interactive demo environment
- Allows exploration of report features without authentication
- Read-only access to sample data

---

## 4. TRY REPORT PAGE (/try/report) ✅ verified live — light theme, on-brand

### Route Details
- **URL**: `/try/report`
- **Authentication**: None (public)
- **Type**: GET
- **Description**: Detailed view of interactive demo report

### Content
- Full report body from demo data
- Report visualization and metrics
- Drill-down capabilities (read-only)
- Method appendix with formulas and methodology

---

## 5. LOGGED OUT PAGE (/logged-out) ✅ verified live — light theme, on-brand

### Route Details
- **URL**: `/logged-out`
- **Authentication**: None (public)
- **Type**: GET
- **Description**: Post-logout confirmation page

### Content

#### Main Panel
- **Heading**: "You're signed out"
- **Description**: "Sign back in to pick up where you left off."
- **Button**: "Sign in" (links to `/login`)

---

## 6. CONNECT PAGE (/connect) ✅ verified live — light theme, on-brand

### Route Details
- **URL**: `/connect`
- **Authentication**: Required (session)
- **Type**: GET, POST
- **Step**: 1 of 5 (Onboarding wizard)
- **Description**: Connect Jira or ClickUp as data source

### Page Header
- **Step Navigation**: Shows steps 1-5 with current step highlighted
- **Eyebrow**: "Step 1: Connect"
- **Main Heading**: "Where does your team track work?" (or "Connect your [Provider]")
- **Description**: "CostFlow connects read-only, analyzes your workflow history, and prices the friction. Credentials are encrypted at rest and never shown again."

### Two Variants

#### Variant A: Provider Picker (First visit or picker requested)
- **Display**: Grid of provider cards
- **Cards** (one per available provider):
  - **Jira Card**:
    - Title: "Jira"
    - Blurb: Description from descriptor
    - Link: `/connect?provider=jira`
  - **ClickUp Card**:
    - Title: "ClickUp"
    - Blurb: Description from descriptor
    - Link: `/connect?provider=clickup`

#### Variant B: Provider-Specific Form
- **Title**: "Connect your [Provider name]"
- **Lead Text**: Provider-specific connection instructions

### Form Contents
- **Form Action**: POST `/connect`
- **CSRF Token**: Hidden input field
- **Provider ID**: Hidden input field
- **Dynamic Fields** (from connector descriptor):
  - Workspace/Instance URL (text field)
    - Label: "Workspace" or "Instance"
    - Placeholder: Provider-specific (e.g., "https://my-jira.atlassian.net")
    - Auto-focus: On first visit
  - API Token (password field - secret)
    - Label: "API token" or "Access token"
    - Placeholder: "••••••••••••"
- **Submit Button**: "Validate & connect"

### Status Messages

#### Info Note (if already connected to same provider)
- **Message**: "Connected: [Current connection description]. Submitting replaces the stored credentials."
- **Styling**: Info-level alert

#### Info Note (if connected to different provider)
- **Message**: "This workspace is currently connected to [Other Provider]. Connecting [New Provider] replaces that connection and restarts setup from scope selection; existing reports are kept."
- **Styling**: Info-level alert

#### Error Message (if validation fails)
- **On 400 response**: Form re-renders with:
  - User-entered values preserved (not the secret)
  - Error message displayed (examples):
    - "We couldn't validate this connection (authentication-error, HTTP 401). Check every field and that the token was copied completely, then try again."
    - "API validation failed (rate-limited, HTTP 429)."

### Help Section
- **Details/Disclosure**: Collapsible help section
- **Content**: Provider-specific help HTML (e.g., "How to find your Jira API token")
- **Open on first visit**: Yes (when `helpOpen` is true)
- **Open on provider switch**: No (collapsed)

### Navigation
- **Switch Provider Link** (if multiple providers available):
  - Text: "Not [Provider Name]? Choose a different tracker."
  - Link: `/connect?picker=1`

---

## 7. SCOPE PAGE (/scope) ✅ inherits shared design system (light tokens, no legacy colors — grep-verified); wizard steps not click-tested live (no real Jira/ClickUp creds this session)

### Route Details
- **URL**: `/scope`
- **Authentication**: Required (session)
- **Type**: GET, POST
- **Step**: 2 of 5 (Onboarding wizard)
- **Prerequisite**: Must have completed `/connect`
- **Description**: Select which projects/spaces to analyze

### Page Header
- **Step Navigation**: Shows steps 1-5 with current step (2) highlighted
- **Eyebrow**: "Step 2: Scope"
- **Main Heading**: "Choose the [Scope Noun] to import" (e.g., "Choose the project to import")
- **Description**: "Pick the [Provider Name] [Scope Noun Singular] you want CostFlow to analyze. You can reconnect and switch it later."

### Two Variants

#### Variant A: Empty Result (No scopes found)
- **Empty State Container**:
  - **Heading**: "No [Scope Noun Plural] found"
  - **Message**: "This account can't see any [Provider Name] [Scope Noun Plural]. Check that the API token belongs to a user with access, then reconnect."
  - **Button**: "Back to connection" (links to `/connect`)

#### Variant B: List of Scopes
- **Form Action**: POST `/scope`
- **CSRF Token**: Hidden input field
- **Radio Button List** (one per available scope):
  - **Each Option**:
    - Input type: Radio button (name="scope", value=index)
    - Label: "[Scope Name] ([Scope ID])"
    - Pre-selected: If `workspace.scopeId === scope.id` OR (no scopeId AND only one scope)
    - Required: Yes
- **Submit Button**: "Import this [Scope Noun Singular]"

### Error Handling
- **On 400 response**: Form re-renders with error message
  - Example: "That selection is no longer valid. The [Scope Noun Singular] list may have changed."
  - Button to retry: "Back to selection" (links to `/scope`)
- **On scope list fetch failure**: Import error page shown (see error handling section)

---

## 8. MAPPING/STATUSES PAGE (/mapping/statuses) ✅ inherits shared design system (light tokens, no legacy colors — grep-verified); wizard steps not click-tested live (no real Jira/ClickUp creds this session)

### Route Details
- **URL**: `/mapping/statuses`
- **Authentication**: Required (session)
- **Type**: GET, POST
- **Step**: 3 of 5 (Onboarding wizard)
- **Prerequisites**: Must have completed `/connect` and `/scope`
- **Description**: Map issue statuses to cost stages

### Page Header
- **Step Navigation**: Shows steps 1-5 with current step (3) highlighted
- **Eyebrow**: "Step 3: Map"
- **Main Heading**: "Map statuses to stages"
- **Description**: Explains status mapping to stages (active, queue, stalled, etc.)

### Form Contents
- **Form Action**: POST `/mapping/statuses`
- **CSRF Token**: Hidden input field

### Status Mapping Table/Form
- **Headers**: [Status Name] | [Stage Kind] | [Color/Badge]
- **Rows** (one per unique status from imported scope):
  - **Status Name**: Display name from tracker (read-only)
  - **Stage Dropdown**: Select field with options:
    - active
    - queue
    - stalled
    - done
    - other
  - **Current Selection**: Pre-filled from stored workspace mapping
- **Minimum Mapping**: At least one status must map to each required stage

### Validation
- **On successful submission**:
  - Statuses stored in workspace
  - Redirect to `/mapping/actors`
  - Telemetry event: `tm-web-statuses-mapped`
- **On error**:
  - Form re-renders with error message
  - User values preserved

---

## 9. MAPPING/ACTORS PAGE (/mapping/actors) ✅ inherits shared design system (light tokens, no legacy colors — grep-verified); wizard steps not click-tested live (no real Jira/ClickUp creds this session)

### Route Details
- **URL**: `/mapping/actors`
- **Authentication**: Required (session)
- **Type**: GET, POST
- **Step**: 4 of 5 (Onboarding wizard)
- **Prerequisites**: Must have completed `/connect`, `/scope`, and `/mapping/statuses`
- **Description**: Map team members for cost attribution

### Page Header
- **Step Navigation**: Shows steps 1-5 with current step (4) highlighted
- **Eyebrow**: "Step 4: Map"
- **Main Heading**: "Map actors (team members)"
- **Description**: Explains individual cost attribution by team member

### Form Contents
- **Form Action**: POST `/mapping/actors`
- **CSRF Token**: Hidden input field

### Actor Mapping Table/Form
- **Headers**: [Actor Name] | [Cost Category] | [Status]
- **Rows** (one per unique actor/user from imported scope):
  - **Actor Name**: Display name from tracker (read-only)
  - **Cost Category Dropdown**: Select field with options:
    - engineering (assigned work)
    - management (status changes, comments)
    - customer (external feedback)
    - unpriced (no cost)
  - **Current Selection**: Pre-filled from stored workspace mapping
  - **Status Indicator**: Shows if actor cost is priced or unpriced

### Validation
- **On successful submission**:
  - Actors stored in workspace
  - Redirect to `/assumptions`
  - Telemetry event: `tm-web-actors-mapped`

---

## 10. ASSUMPTIONS PAGE (/assumptions) ✅ inherits shared design system (light tokens, no legacy colors — grep-verified); wizard steps not click-tested live (no real Jira/ClickUp creds this session)

### Route Details
- **URL**: `/assumptions`
- **Authentication**: Required (session)
- **Type**: GET, POST
- **Step**: 5 of 5 (Onboarding wizard)
- **Prerequisites**: Must have completed all prior steps
- **Description**: Configure cost assumptions and rates

### Page Header
- **Step Navigation**: Shows steps 1-5 with current step (5) highlighted
- **Eyebrow**: "Step 5: Assumptions"
- **Main Heading**: "Set your cost model"
- **Description**: Explains how to configure hourly rates and cost factors

### Form Sections

#### Currency Selection
- **Label**: "Currency"
- **Dropdown/Select**: Options from supported currencies (USD, GBP, EUR, etc.)
- **Default**: USD or last used

#### Hourly Rates by Role
- **Section Title**: "Hourly rates"
- **Description**: "Assigned work costs are measured in standard hours loaded at these rates. These can be per-person averages or per-team targets."
- **Fields** (one per cost category):
  - **Engineering Rate**:
    - Label: "Engineering (pers/hr)"
    - Input type: Number or currency
    - Placeholder: "95"
    - Unit: Currency per hour
    - Default: Vendor-seeded (e.g., $95)
  - **Management Rate**:
    - Label: "Management (pers/hr)"
    - Input type: Number or currency
    - Default: Vendor-seeded
  - **Customer Rate**:
    - Label: "Customer (pers/hr)"
    - Input type: Number or currency
    - Default: Vendor-seeded

#### Time Allocation per Stage
- **Section Title**: "Time allocation"
- **Description**: "How much engineering attention per day items spend in each stage (as a percent of a full working day)."
- **Fields** (one per stage):
  - **Active Stage**:
    - Label: "Active (% of day)"
    - Input: Percentage field (0-100)
    - Default: Vendor-seeded (e.g., 50%)
  - **Queue Stage**:
    - Label: "Queue (% of day)"
    - Default: Vendor-seeded (e.g., 5%)
  - **Stalled Stage**:
    - Label: "Stalled (% of day)"
    - Default: Vendor-seeded (e.g., 1%)

#### Cost Factors
- **Section Title**: "Cost factors"
- **Description**: "Multipliers applied to specific friction types."
- **Fields**:
  - **Overdue Factor**:
    - Label: "Overdue multiplier"
    - Input: Decimal (1.0, 1.5, 2.0, etc.)
    - Default: Vendor-seeded (e.g., 2.0)
  - **Aging Factor**:
    - Label: "Aging multiplier"
    - Default: Vendor-seeded

#### Help Text
- **Collapsible Section**: "About these assumptions"
- **Content**: Detailed explanation of each assumption and how they affect pricing

### Submit Button
- **Button**: "Create your first report" or "Update and re-run"
- **On success**:
  - Assumptions stored in workspace
  - Redirect to `/dashboard` or trigger first analysis
  - Telemetry event: `tm-web-assumptions-set`

---

## 11. DASHBOARD PAGE (/dashboard) ✅ inherits shared design system (light tokens, no legacy colors — grep-verified); wizard steps not click-tested live (no real Jira/ClickUp creds this session)

### Route Details
- **URL**: `/dashboard`
- **Authentication**: Required (session)
- **Type**: GET
- **Description**: Main authenticated dashboard and workspace overview

### Page Header
- **Site Header**: Sticky, with backdrop blur
- **Brand Lockup**: CostFlow logo (responsive)
- **Navigation**: Links to Runs, Organization, Settings
- **User Menu**: Avatar and sign-out button

### Main Sections

#### Hero Section
- **Large Metric**: Total friction cost (e.g., "$2,229")
- **Currency Tag**: USD (right-aligned, smaller)
- **Subtitle**: "Total priced friction"
- **Range**: "1,114 to 4,458 expected range"
- **Tier Pills**: "A × 3" "B × 2" "C × 1" (showing confidence distribution)
- **Trend Line** (if previous analysis exists):
  - Example: "▲ $342 more than the previous analysis" (upward trend, red)
  - OR: "▼ $287 less than the previous analysis" (downward trend, green)
  - OR: "Unchanged vs the previous analysis" (neutral)

#### Top Finding Card
- **Rank**: "#1"
- **Friction Type**: "Queue wait in the "To Do" queue"
- **Verb**: "is costing"
- **Amount**: "$1,062" (expected value)
- **Range**: "$531 to $2,124"
- **Confidence**: Tier A/B/C badge
- **Description**: "Work waiting in the queue / Items sitting untouched / Missed due dates" (depends on friction type)

#### Quick Actions
- **Run Another Analysis Button**: "Run another analysis"
  - Triggers POST to `/runs` to create new analysis job
- **View Full Report Link**: "View full report"
  - Links to `/reports/:runId` for latest run

#### Recent Runs List
- **Title**: "Analysis history"
- **List**: Newest first
- **Each Run Row**:
  - **Title**: Expected total (e.g., "$2,229 expected")
  - **Metadata**: "Jul 20, 2024, 14:35 UTC, 5 priced. Ref a1b2c3d4e5f6"
  - **Action**: "View report →" (links to `/reports/:runId`)

#### Failed Jobs List (if any)
- **Title**: "Recent failures"
- **Display**: Only if recent failures exist
- **Each Failure Row**:
  - **Timestamp**: When it failed (e.g., "Jul 19, 2024, 10:00 UTC")
  - **Error**: Error class and message (e.g., "authentication-failed: API token expired")
  - **Action**: "Reconnect" or "Try again" button (links to `/connect`)

#### Workspace Status
- **Connection Status**: "Connected to [Provider] workspace [Name]"
- **Scope**: "Analyzing [Scope Name]"
- **Last Updated**: Timestamp of latest run

---

## 12. RUNS PAGE (/runs) ✅ inherits shared design system (light tokens, no legacy colors — grep-verified); wizard steps not click-tested live (no real Jira/ClickUp creds this session)

### Route Details
- **URL**: `/runs`
- **Authentication**: Required (session)
- **Type**: GET
- **Description**: List all analysis runs for the workspace

### Page Header
- **Site Header**: Sticky navigation
- **Title**: "Analysis runs"
- **Description**: "Your friction analysis history"

### Main Content

#### Filter/Sort Options
- **Sort**: Newest first (default)
- **Filter**: By status (all, completed, failed)

#### Runs List
- **Type**: Ordered list
- **Each Run Row**:
  - **Title/Headline**: Expected total (e.g., "$2,229 expected") or "Friction analysis" if can't be summarized
  - **Metadata**: 
    - Timestamp: "Jul 20, 2024, 14:35 UTC"
    - Priced count: "5 priced" (only if priced > 0)
    - Run ID: "Ref a1b2c3d4e5f6"
  - **Link**: Entire row links to `/reports/:runId`
  - **Arrow Indicator**: "View report →" on hover

#### Empty State
- **Message**: "No runs yet. Run your first analysis from the dashboard."
- **Button**: "Go to dashboard" (links to `/dashboard`)

---

## 13. REPORT PAGE (/reports/:runId) ✅ verified live — light theme, on-brand (same template as /demo, /try/report)

### Route Details
- **URL**: `/reports/:runId`
- **Authentication**: Required (session)
- **Type**: GET
- **Description**: Detailed report view for a specific analysis

### Page Header
- **Back Navigation**: "← Back to runs"
- **Report Title**: "Friction report"
- **Run Metadata**: Run ID, timestamp, scope name

### Hero Section (Same as Dashboard)
- **Large Metric**: Total friction cost
- **Currency**: USD or configured currency
- **Subtitle**: "Total priced friction"
- **Range**: Expected range
- **Tier Distribution**: Confidence tier pills
- **Trend**: Comparison to previous analysis (if exists)

### Ranked Frictions List
- **Title**: "Ranked frictions"
- **Sorting**: By rank (highest cost first)
- **Each Friction Row**:
  - **Rank**: "#1", "#2", etc.
  - **Friction Name**: "Queue wait in To Do", "Overdue exposure in Review", etc.
  - **Confidence Tier**: A, B, or C badge
  - **Amount**: Expected value (e.g., "$1,062")
  - **Range**: Low to high estimates
  - **Bar Chart**: Visual magnitude representation (% of total)
  - **Expandable Details**: Click to expand and see:
    - Formula: The mathematical calculation
    - Items: Count and details
    - Rate: Applied hourly rate
    - Confidence breakdown: Why it's A/B/C tier
    - Individual item list: Which issues contribute

### Unpriced Frictions (if any)
- **Section Title**: "Unpriced frictions"
- **Note**: "These friction types couldn't be priced because they depend on unconfirmed assumptions."
- **List** (if exists):
  - Each unpriced friction with similar structure but no cost

### Methodology Appendix
- **Title**: "How we calculated this"
- **Content**:
  - Formula explanations
  - Assumption summary (rates, time allocation, cost factors)
  - Methodology details
  - Confidence tier definitions

### Actions
- **Run Another Analysis Button**: "Run another analysis"
- **Print Report Link**: "Print or save as PDF" (links to `/reports/:runId/print`)

---

## 14. REPORT PRINT PAGE (/reports/:runId/print) ✅ fixed stale hardcoded tokens (print export), verified

### Route Details
- **URL**: `/reports/:runId/print`
- **Authentication**: Required (session)
- **Type**: GET
- **Description**: Print-optimized report view

### Content
- Same as regular report page but optimized for printing:
  - Removed navigation/sticky headers
  - Optimized for PDF export
  - Proper page breaks
  - Removed hover states
  - Print-friendly colors and contrast

### Print Features
- CSS print media queries applied
- Page size: A4
- Margins: Optimized for printing
- Browser print dialog integration

---

## 15. RAW REPORT DATA PAGE (/reports/:runId/raw) — N/A, raw JSON download, no HTML

### Route Details
- **URL**: `/reports/:runId/raw`
- **Authentication**: Required (session)
- **Type**: GET
- **Description**: Raw JSON export of analysis run

### Content
- **MIME Type**: `application/json`
- **Headers**: 
  - Content-Disposition: `attachment; filename="report-:runId.json"`
- **Body**: Full AnalysisRun JSON object with:
  - run metadata (id, createdAt, etc.)
  - imported items and issues
  - calculated frictions and costs
  - assumptions used
  - all intermediate calculations

---

## 16. SETTINGS PAGE (/settings) ✅ inherits shared design system (light tokens, no legacy colors — grep-verified); wizard steps not click-tested live (no real Jira/ClickUp creds this session)

### Route Details
- **URL**: `/settings`
- **Authentication**: Required (session)
- **Type**: GET
- **Description**: User settings and account management

### Page Header
- **Title**: "Settings"
- **Navigation**: Links to tabs/sections

### Sections

#### Workspace Management
- **Title**: "Workspaces"
- **Description**: "Your connected workspaces"
- **List** (if multiple workspaces):
  - Each workspace with:
    - Name
    - Provider (Jira/ClickUp)
    - Connection status
    - Scope
    - Actions: 
      - "Reconnect" button (links to `/connect`)
      - "Delete" button (POST to `/workspaces/:workspaceId/delete`)

#### Delete Workspace
- **Title**: "Delete workspace"
- **Warning**: "This action cannot be undone. All reports and analysis history will be permanently deleted."
- **Button**: "Delete workspace" (destructive, requires confirmation)
- **Confirmation Modal**: 
  - "Are you sure? This cannot be undone."
  - "Delete" button (red/destructive)
  - "Cancel" button

#### Delete Account
- **Title**: "Delete account"
- **Warning**: "Permanently delete your CostFlow account and all associated data. This action cannot be undone."
- **Button**: "Delete my account" (destructive, requires confirmation)
- **Confirmation Modal**:
  - "Are you sure? This cannot be undone."
  - "Delete" button (red/destructive)
  - "Cancel" button

#### Sign Out
- **Button**: "Sign out" (POST to `/logout`)

---

## 17. ORGANIZATION PAGE (/org) ✅ inherits shared design system (light tokens, no legacy colors — grep-verified); wizard steps not click-tested live (no real Jira/ClickUp creds this session)

### Route Details
- **URL**: `/org`
- **Authentication**: Required (session)
- **Type**: GET
- **Description**: Organization management hub (for managers/admins)

### Page Header
- **Title**: "Organization"
- **Navigation**: Tabs for Members, Workspaces, Invitations, Settings

### Tabs/Sections

#### Members Tab
- **Title**: "Team members"
- **Description**: "Manage who has access to this organization"
- **Members List**:
  - Each member row:
    - **Avatar**: User initials or icon
    - **Name**: Display name
    - **Email**: Email address
    - **Role**: Manager / Member / Viewer (with role selector)
    - **Status**: Active / Pending
    - **Actions**:
      - Role dropdown (POST to `/org/members/:id/role`)
      - Remove button (POST to `/org/members/:id/remove`)

#### Workspaces Tab
- **Title**: "Workspaces"
- **Description**: "Manage workspace access"
- **Workspaces List**:
  - Each workspace row:
    - **Name**: Workspace name
    - **Provider**: Jira/ClickUp
    - **Members**: Count or list
    - **Actions**:
      - "Manage access" button (expands to show member list)
      - Add member button (POST to `/workspaces/:workspaceId/members`)
      - Remove member button (per member, POST to `/workspaces/:workspaceId/members/:userId/remove`)

#### Invitations Tab
- **Title**: "Pending invitations"
- **Description**: "People invited to join"
- **Pending Invitations List**:
  - Each invitation row:
    - **Email**: Invited email
    - **Status**: Pending
    - **Sent Date**: When invited
    - **Actions**:
      - Revoke button (POST to `/org/invitations/:id/revoke`)

#### Settings Tab
- **Title**: "Organization settings"
- **Organization Name**:
  - **Input field**: Current name
  - **Edit button**: Allows inline editing
  - **Save button**: POST to `/org/rename`
  - **Cancel button**: Reverts changes

#### Invite Users Section
- **Title**: "Invite new members"
- **Form**:
  - **Email Input**: "Email address"
  - **Role Selector**: Manager / Member / Viewer
  - **Add Button**: "Send invitation"
  - **Submit**: POST to `/org/invitations`

---

## 18. INVITE ACCEPTANCE PAGE (/invite/:token) ✅ inherits shared design system (light tokens, no legacy colors — grep-verified); wizard steps not click-tested live (no real Jira/ClickUp creds this session)

### Route Details
- **URL**: `/invite/:token`
- **Authentication**: Optional (works with or without session)
- **Type**: GET
- **Description**: Accept workspace invite via token

### Two Variants

#### Variant A: Not Logged In
- **Title**: "You've been invited"
- **Message**: "[Name] invited you to join [Organization] on CostFlow"
- **Buttons**:
  - "Accept and sign in" (links to `/login?invite=[token]`)
  - "Sign up" (links to `/signup?invite=[token]`)

#### Variant B: Logged In
- **Process**:
  - Automatically accepts invitation
  - Updates user org membership
  - Redirects to `/org` with query param `?done=granted`
- **Success Message**: "You've joined [Organization]"

---

## 19. ORGANIZATION RENAME (/org/rename) — POST action, no standalone page (renders within an already-covered page)

### Route Details
- **URL**: `/org/rename`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Update organization name

### Request Body
```json
{
  "csrf": "token",
  "name": "New Organization Name"
}
```

### Response
- **Success**: Redirects to `/org?done=renamed`
- **Error**: Returns 400 with error message

---

## 20. SEND INVITATIONS (/org/invitations) — POST action, no standalone page (renders within an already-covered page)

### Route Details
- **URL**: `/org/invitations`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Send invitations to new users

### Request Body
```json
{
  "csrf": "token",
  "email": "user@example.com",
  "role": "Member"
}
```

### Validation
- **Email**: Must be valid email format
- **Role**: Must be Manager / Member / Viewer
- **CSRF**: Must match session

### Response
- **Success**: Redirects to `/org?done=invited`
- **Error**: Returns 400 with error message

---

## 21. REVOKE INVITATION (/org/invitations/:id/revoke) — POST action, no standalone page (renders within an already-covered page)

### Route Details
- **URL**: `/org/invitations/:id/revoke`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Cancel pending invitation

### Request Body
```json
{
  "csrf": "token"
}
```

### Response
- **Success**: Redirects to `/org?done=revoked`

---

## 22. UPDATE MEMBER ROLE (/org/members/:id/role) — POST action, no standalone page (renders within an already-covered page)

### Route Details
- **URL**: `/org/members/:id/role`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Change member role

### Request Body
```json
{
  "csrf": "token",
  "role": "Manager" | "Member" | "Viewer"
}
```

### Response
- **Success**: Redirects to `/org?done=role-updated`

---

## 23. REMOVE MEMBER (/org/members/:id/remove) — POST action, no standalone page (renders within an already-covered page)

### Route Details
- **URL**: `/org/members/:id/remove`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Remove member from organization

### Request Body
```json
{
  "csrf": "token"
}
```

### Response
- **Success**: Redirects to `/org?done=removed`

---

## 24. ADD WORKSPACE MEMBER (/workspaces/:workspaceId/members) — POST action, no standalone page (renders within an already-covered page)

### Route Details
- **URL**: `/workspaces/:workspaceId/members`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Grant workspace access to org member

### Request Body
```json
{
  "csrf": "token",
  "userId": "user-id"
}
```

### Response
- **Success**: Redirects to `/org?done=granted`

---

## 25. REMOVE WORKSPACE MEMBER (/workspaces/:workspaceId/members/:userId/remove) — POST action, no standalone page (renders within an already-covered page)

### Route Details
- **URL**: `/workspaces/:workspaceId/members/:userId/remove`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Revoke workspace access

### Request Body
```json
{
  "csrf": "token"
}
```

### Response
- **Success**: Redirects to `/org?done=ungranted`

---

## 26. DELETE WORKSPACE (/workspaces/:workspaceId/delete) — POST action, no standalone page (renders within an already-covered page)

### Route Details
- **URL**: `/workspaces/:workspaceId/delete`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Permanently delete workspace

### Request Body
```json
{
  "csrf": "token"
}
```

### Response
- **Success**: Redirects to `/settings`
- **Error**: Returns 400 with error message

---

## 27. DELETE ACCOUNT (/account/delete) — POST action, no standalone page (renders within an already-covered page)

### Route Details
- **URL**: `/account/delete`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Permanently delete user account

### Request Body
```json
{
  "csrf": "token"
}
```

### Response
- **Success**: Clears session and redirects to `/logged-out`
- **Error**: Returns 400 with error message

---

## 28. CREATE RUN / EXECUTE ANALYSIS (/runs) ✅ loading page fixed (light tokens), verified

### Route Details
- **URL**: `/runs`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Initiate new cost analysis job

### Request Body
```json
{
  "csrf": "token"
}
```

### Process
1. Validates CSRF and session
2. Creates new analysis job (background)
3. Returns response based on `awaitJobs` setting:
   - If `awaitJobs=true` (tests/small workspaces):
     - Waits for job completion
     - Returns HTML report
   - If `awaitJobs=false` (production):
     - Returns immediate redirect to `/jobs/:jobId`

### Response
- **Success**: Redirects to `/jobs/:jobId` or returns full report
- **Error**: Returns 400 with error message

### Telemetry
- Event: `tm-web-run-created`

---

## 29. JOB STATUS (/jobs/:jobId) ✅ loading page fixed (light tokens), verified

### Route Details
- **URL**: `/jobs/:jobId`
- **Authentication**: Required (session)
- **Type**: GET
- **Description**: Poll job execution status

### Response

#### While Running
```html
<div class="loading">
  <h2>Running your analysis...</h2>
  <p>Stage: [stage] (e.g., "Importing issues")</p>
  <progress value="45" max="100"></progress>
  <p>Auto-refreshing...</p>
</div>
```

#### On Completion
- Redirects to `/reports/:runId`

#### On Failure
- Shows error page with message and action button

---

## 30. LOGOUT (/logout) — POST action, no standalone page (renders within an already-covered page)

### Route Details
- **URL**: `/logout`
- **Authentication**: Required (session)
- **Type**: POST
- **Description**: Sign out user

### Process
1. Clears session cookie
2. Clears OIDC session (if applicable)
3. Redirects to `/logged-out`

### Request Body
```json
{
  "csrf": "token"
}
```

---

## 31. ADMIN ANALYTICS PAGE (/admin) ✅ inherits shared design system (light tokens, no legacy colors — grep-verified); wizard steps not click-tested live (no real Jira/ClickUp creds this session) (403/404 without a configured admin email — not click-tested)

### Route Details
- **URL**: `/admin`
- **Authentication**: Required (session)
- **Type**: GET
- **Access**: Restricted to configured `adminEmails`
- **Description**: Founder analytics for v1 free beta

### Content
- **Usage Statistics**:
  - Active users count
  - Analysis runs count
  - Total friction priced
  - Success/failure rates
- **Per-User Analytics**:
  - User list with usage stats
  - Signup date
  - Last active date
  - Number of runs
  - Total friction analyzed
- **Charts/Visualizations**:
  - Daily active users trend
  - Run success rate
  - Common error types

---

## 32. TERMS OF SERVICE (/terms) ✅ verified live — light theme, on-brand

### Route Details
- **URL**: `/terms`
- **Authentication**: None (public)
- **Type**: GET
- **Description**: Legal terms of service

### Content
- Self-contained HTML with strict CSP
- Inline styles only
- Rendered from `renderTerms()` function
- Static content (no scripts)

---

## 33. PRIVACY POLICY (/privacy) ✅ verified live — light theme, on-brand

### Route Details
- **URL**: `/privacy`
- **Authentication**: None (public)
- **Type**: GET
- **Description**: Privacy policy

### Content
- Self-contained HTML with strict CSP
- Inline styles only
- Rendered from `renderPrivacy()` function
- Static content (no scripts)

---

## Common UI Patterns & Components

### Step Navigation Stepper
- **Display**: Horizontal stepper showing steps 1-5
- **Current Step**: Highlighted/active state
- **Completed Steps**: Checkmark or filled indicator
- **Future Steps**: Faded/disabled state
- **Labels**: "Connect", "Scope", "Map", "Map", "Assumptions"

### Form Patterns
- **Validation**: Server-side, HTML5 validation on client
- **Error Display**: Red alert box at top of form
- **Field Preservation**: On error, form re-renders with user values (except secrets)
- **CSRF Protection**: Hidden input on every POST form
- **Submit Button**: Disabled until valid input

### Alert/Message Components
- **Info Level**: Blue/info styling, info box
- **Warning Level**: Yellow/warn styling, warning box
- **Error Level**: Red/error styling, error box with `role="alert"`
- **Success Level**: Green/positive styling

### Button Styles
- **Primary**: "Get started free", "Connect", "Submit" (solid, full color)
- **Ghost**: "Try a live demo" (outlined, transparent background)
- **Destructive**: "Delete" (red, warning styling)
- **Secondary**: "Back", "Cancel" (muted)

### List Patterns
- **Run List**: Headline + metadata + view link
- **Member List**: Avatar + name + email + role selector + actions
- **Friction List**: Rank + name + confidence badge + amount + range + bar + expandable

### Responsive Design
- **Mobile**: Single column, stacked forms
- **Tablet**: Two columns where appropriate
- **Desktop**: Three columns or full layouts
- **Sticky Header**: Navigation sticks to top on scroll
- **Touch-Friendly**: Large tap targets (min 44px)

---

## Error Handling & Messages

### CSRF Error
- **Message**: "Session expired. Please try again."
- **HTTP Code**: 403
- **Page**: Error page with "Start over" button (links to `/connect`)

### Authentication Error
- **Message**: "Authentication failed. Please sign in."
- **HTTP Code**: 401
- **Redirect**: `/login`

### Connection Validation Error
- **Message**: "We couldn't validate this connection (error-class, HTTP status). Check every field and that the token was copied completely, then try again."
- **HTTP Code**: 400
- **Form State**: Re-renders with preserved non-secret values

### Scope Import Error
- **Message**: "We encountered an error while listing your [Scope Noun Plural]. This usually means the API token doesn't have permission or the connection failed."
- **HTTP Code**: 400
- **Action**: "Try again" or "Back to connection"

### Reliability/Size Limit Error
- **Message**: "We can't analyze this [Scope Noun Singular] — it contains too many work items ([count]). The limit is [max] items."
- **HTTP Code**: 413
- **Action**: "Try a smaller scope" or "Contact us"

### Job Failure
- **Message**: "The analysis failed. Try again or contact support."
- **Details**: Error class and optional message (not raw error)
- **HTTP Code**: 500
- **Action**: "Try again" button or "Contact support" link

---

## Telemetry Events

### Web Events Fired
- `tm-web-workspace-connected`: Provider selection and connection result
- `tm-web-statuses-mapped`: Status mapping completed
- `tm-web-actors-mapped`: Actor mapping completed
- `tm-web-assumptions-set`: Assumptions configured
- `tm-web-run-created`: Analysis job created
- `tm-web-run-succeeded`: Analysis job succeeded
- `tm-web-run-failed`: Analysis job failed
- `tm-web-member-added`: Organization member added
- `tm-web-member-removed`: Organization member removed
- `tm-web-workspace-deleted`: Workspace deleted
- `tm-web-account-deleted`: Account deleted
- `tm-web-org-renamed`: Organization renamed

