# CostFlow Website Pages

Complete list of all pages and routes in the CostFlow web application.

## Public Pages (No Authentication Required)

### Landing Page

- **Route**: `/`
- **Type**: GET
- **Description**: Public marketing landing page showcasing CostFlow for logged-out visitors. Features product mockup, hero section, and call-to-action buttons. Logged-in users are redirected based on their role.

### Demo Report

- **Route**: `/demo`
- **Type**: GET
- **Description**: Public sample report built from demo Jira data. Allows visitors to see what a CostFlow report looks like without signing in. Includes banner and CTA to sign up.

### Try Report (Demo Interactive)

- **Route**: `/try`
- **Type**: GET
- **Description**: Interactive try-before-you-buy demo page allowing visitors to explore report functionality without authentication.

### Try Report Details

- **Route**: `/try/report`
- **Type**: GET
- **Description**: Detailed view of the interactive demo report with full report body and visualization.

### Terms of Service

- **Route**: `/terms`
- **Type**: GET
- **Description**: Public terms of service page. Rendered as static HTML with strict CSP (no external scripts/assets).

### Privacy Policy

- **Route**: `/privacy`
- **Type**: GET
- **Description**: Public privacy policy page. Rendered as static HTML with strict CSP (no external scripts/assets).

## Asset & Metadata Routes

### Logo

- **Route**: `/brand/logo.svg`
- **Type**: GET
- **Description**: Brand logo SVG asset. Returns the official CostFlow logo for marketing and UI purposes.

### Favicon

- **Route**: `/favicon.ico`
- **Type**: GET
- **Description**: Favicon file for browser tabs. Standard 32x32 pixel format.

### Web App Manifest

- **Route**: `/site.webmanifest`
- **Type**: GET
- **Description**: PWA (Progressive Web App) manifest file with app metadata, icons, and configuration.

### Open Graph Image

- **Route**: `/og.jpg`
- **Type**: GET
- **Description**: Social sharing image (1200×630px) for Open Graph meta tags. Used when sharing links on social media.

### Apple Touch Icon

- **Route**: `/apple-touch-icon.png`
- **Type**: GET
- **Description**: iOS home screen icon for when users save the app to their device.

### Robots.txt

- **Route**: `/robots.txt`
- **Type**: GET
- **Description**: SEO robots file controlling search engine crawler access.

### Sitemap

- **Route**: `/sitemap.xml`
- **Type**: GET
- **Description**: XML sitemap listing all public URLs for search engine indexing.

## Authentication Routes

### Logout

- **Route**: `/logout`
- **Type**: POST
- **Description**: Clears user session and signs out the current user.

### Logged Out

- **Route**: `/logged-out`
- **Type**: GET
- **Description**: Confirmation page shown after successful logout.

### Invite Acceptance

- **Route**: `/invite/:token`
- **Type**: GET
- **Description**: Accepts workspace invite via token. Allows users to join existing organizations/workspaces.

## Dashboard & Reports

### Dashboard

- **Route**: `/dashboard`
- **Type**: GET
- **Description**: Main authenticated dashboard showing workspace overview, recent runs, and navigation to analysis features. Landing page for authenticated members.

### List All Runs

- **Route**: `/runs`
- **Type**: GET
- **Description**: Shows all analysis runs the user has access to. Filterable list of past analyses.

### Specific Report View

- **Route**: `/reports/:runId`
- **Type**: GET
- **Description**: Detailed report view for a specific analysis run. Shows ranked friction costs, metrics, and detailed breakdown.

### Report Raw Data

- **Route**: `/reports/:runId/raw`
- **Type**: GET
- **Description**: Raw JSON data export of the analysis run. Used for programmatic access and data export.

### Report Print View

- **Route**: `/reports/:runId/print`
- **Type**: GET
- **Description**: Print-optimized version of the report. Formatted for printing to PDF or paper.

## Admin & Analytics

### Admin Page

- **Route**: `/admin`
- **Type**: GET
- **Description**: Founder/admin analytics page. Shows v1 free beta usage metrics and analytics. Access restricted to configured admin emails.

## Onboarding & Configuration Wizard

### Connect Data Source

- **Route**: `/connect`
- **Type**: GET, POST
- **Description**: First step of onboarding. Allows user to select and authenticate with Jira or ClickUp as their data source.

### Scope Selection

- **Route**: `/scope`
- **Type**: GET, POST
- **Description**: Second step. User selects which Jira projects or ClickUp spaces to analyze.

### Status Mapping

- **Route**: `/mapping/statuses`
- **Type**: GET, POST
- **Description**: Third step. Maps issue statuses (e.g., Backlog, In Progress, Done) to CostFlow's stage kinds for cost calculation.

### Actor (User) Mapping

- **Route**: `/mapping/actors`
- **Type**: GET, POST
- **Description**: Fourth step. Maps team members/users in the connected system to define individual cost attribution.

### Assumptions Configuration

- **Route**: `/assumptions`
- **Type**: GET, POST
- **Description**: Fifth step. Configures cost assumptions: hourly rates, stage durations, cost factors per stage, and vendor-seeded defaults.

## Job & Analysis Execution

### Create Run (Execute Analysis)

- **Route**: `/runs`
- **Type**: POST
- **Description**: Initiates a new cost analysis job. Creates background job that imports issues and calculates friction costs.

### Job Status

- **Route**: `/jobs/:jobId`
- **Type**: GET
- **Description**: Polls job execution status. Returns job progress, stage, and results when complete.

## Settings & User Management

### Settings Page

- **Route**: `/settings`
- **Type**: GET
- **Description**: User settings and account management. Shows workspace list and deletion options.

### Delete Workspace

- **Route**: `/workspaces/:workspaceId/delete`
- **Type**: POST
- **Description**: Deletes a workspace and all associated data.

### Delete Account

- **Route**: `/account/delete`
- **Type**: POST
- **Description**: Permanently deletes user account and all associated workspaces.

## Organization & Access Management

### Organization Page

- **Route**: `/org`
- **Type**: GET
- **Description**: Organization management hub. Shows members, pending invitations, roles, and workspace assignments.

### Rename Organization

- **Route**: `/org/rename`
- **Type**: POST
- **Description**: Updates the organization name.

### Invite Users

- **Route**: `/org/invitations`
- **Type**: POST
- **Description**: Sends invite emails to new users to join the organization.

### Revoke Invitation

- **Route**: `/org/invitations/:id/revoke`
- **Type**: POST
- **Description**: Cancels a pending invitation before it's accepted.

### Update Member Role

- **Route**: `/org/members/:id/role`
- **Type**: POST
- **Description**: Changes a member's role (e.g., Manager, Member, Viewer).

### Remove Member

- **Route**: `/org/members/:id/remove`
- **Type**: POST
- **Description**: Removes a member from the organization.

### Add Workspace Members

- **Route**: `/workspaces/:workspaceId/members`
- **Type**: POST
- **Description**: Grants workspace access to org members.

### Remove Workspace Member

- **Route**: `/workspaces/:workspaceId/members/:userId/remove`
- **Type**: POST
- **Description**: Revokes workspace access from a member.

## Architecture Notes

- **Authentication**: All routes (except public pages and assets) require session via OIDC or internal auth
- **Tenant Isolation**: Every route is tenant-scoped via session; data access is isolated per organization
- **CSRF Protection**: All POST requests validate per-session CSRF token
- **Response Format**: Authenticated routes return server-rendered HTML; public routes are self-contained with strict CSP
- **Security**: Provider tokens (Jira/ClickUp) decrypted only where plan allows per user permissions
