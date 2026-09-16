# Cumple Now Responsive Worker Discovery Design

## Purpose

Transform the current worker MVP into a professional, adaptive job-discovery experience for Android, iOS, tablets and desktop browsers. This phase establishes the reusable visual and navigation foundation for later worker, recruiter, messaging and internationalization features.

Approved visual reference: [Cumple Now multi-platform design board](https://p.superdesign.dev/draft/836c61d3-8605-4930-a75d-dbb3c5ad2e31).

## Scope

This delivery includes:

1. A reusable responsive application shell.
2. A new worker home focused on discovering temporary jobs.
3. Advanced local search and filters using the existing repository boundary.
4. Job cards, saved jobs, application status and a job-detail experience.
5. Responsive behavior verified at mobile, tablet and desktop breakpoints.
6. Accessibility, loading, empty and error states for the new experience.

It does not include recruiter ATS workflows, production payments, biometric verification, push notifications, production authentication or multilingual copy. Those remain separate future phases.

## Product Direction

Cumple Now keeps its own identity rather than copying Computrabajo or LinkedIn. The experience combines professional job discovery with temporary-work signals: immediate availability, urgency, verified companies, match percentage, exact schedule, compensation, check-in readiness and worker reputation.

The worker starts on discovery instead of the profile. The first screen must answer four questions quickly:

- What jobs match me now?
- How much and when will I work?
- Can I trust the company?
- What should I improve to access better opportunities?

## Visual System

The approved navy and teal identity remains unchanged:

- Navy `#1A2B4A`: headings, navigation and trust information.
- Teal `#00C896`: primary actions, active states and positive status.
- Soft teal `#E4FAF4`: selected navigation and supportive highlights.
- Background `#F0F3F8`, white surfaces, border `#D9E2EC`, muted copy `#718096`, reward gold `#F5AE28`.
- Inter/system sans typography only.
- Cards use 14–18px corners and subtle borders. Shadows remain restrained.
- Layout and spacing use an 8px grid.

Gradients, glassmorphism, decorative serif typography, neon colors and heavy shadows are prohibited.

## Responsive Architecture

The app uses three deterministic layout classes chosen through `LayoutBuilder` and centralized breakpoint helpers:

### Mobile: below 600 logical pixels

- One content column.
- Fixed five-item bottom navigation.
- Compact top bar and 16–20px horizontal padding.
- Search and actions span the available width.
- Selecting a job opens a dedicated detail screen.
- Android and iOS share the same information architecture while respecting safe areas and platform scroll behavior.

### Tablet: 600–1023 logical pixels

- Compact navigation rail.
- 24px page gutters.
- Two-column job grid when space permits.
- Landscape may show list and detail together; portrait uses stacked navigation.
- All touch targets are at least 48px.

### Desktop web: 1024 logical pixels and above

- Persistent 240px sidebar and 64px top bar.
- Centered workspace capped at 1440px.
- Master-detail layout: filters and job results remain visible while the detail panel changes.
- Keyboard focus, hover and selected states are explicit.
- The detail action area remains visible without covering content.

The layout grows in information density, not by scaling the mobile UI proportionally. Shared components keep identical colors, states and content hierarchy across breakpoints.

## Flutter Component Boundaries

The current large feature files will be split only where this phase needs clear responsibilities:

- `AdaptiveScaffold`: selects bottom navigation, navigation rail or desktop sidebar.
- `WorkerNavigation`: owns destinations, labels and selected state.
- `WorkerDiscoveryPage`: composes greeting, availability, search, filters and results.
- `JobSearchBar`: query entry and filter entry point.
- `JobFilterBar` / `JobFilterSheet`: desktop/tablet inline controls and mobile modal controls backed by the same filter model.
- `JobCard`: one reusable job summary with compact and expanded variants.
- `JobDetailPanel`: full description, company trust signals and application action.
- `WorkerProgressCard`: profile-strength guidance.
- `DiscoveryRepository`: extends the existing marketplace repository with search, saved-job and application operations.

Presentation widgets receive immutable view data and callbacks. They do not call HTTP directly. API-specific mapping stays inside the HTTP repository.

## Navigation

Worker destinations become:

1. Inicio
2. Buscar
3. Postulaciones
4. Mensajes
5. Perfil

Payments, check-in and achievements remain reachable from worker home/profile shortcuts until the information architecture phase decides their long-term placement. The existing three-line menu is removed on mobile because its purpose is unclear; desktop uses the visible sidebar instead.

Navigation selection remains in the shell so changing responsive layout does not reset the active section. A selected job is preserved when resizing between tablet and desktop.

## Discovery Data and State

The discovery state contains:

- Search query.
- Industry, location, date scope and minimum payment filters.
- Urgent-only and recommended-only flags.
- Sort order.
- Selected job ID.
- Saved job IDs.
- Application states.

The same filter model drives demo and API modes. The repository returns typed results rather than UI strings. Money remains integer cents in the API and is formatted at the presentation edge with a currency/locale formatter.

The initial demo supports these application states: `notApplied`, `submitted`, `reviewing`, `accepted` and `closed`. Applying is a local-development action; it does not contact a real employer.

## Search Behavior

Search matches job title, company, industry and location. Filters can be combined and cleared together. Results are ordered by urgency, match score and start time by default. Saved jobs and application states remain visible when filters change.

Desktop uses immediate selection in the detail panel. Mobile and tablet portrait open detail navigation. An empty result presents active filter count, a clear-all action and nearby suggested categories.

Distance filtering remains visibly unavailable until location support is explicitly enabled. The app must not request GPS permission in this phase.

## Accessibility and International Readiness

- Minimum touch target: 48px for new controls.
- Every interactive control has a semantic label.
- Keyboard traversal and visible focus are required on web.
- Status always uses text or an icon in addition to color.
- Text can grow to 200% without clipped primary actions.
- Layouts allow longer translated labels and avoid text embedded in images.
- Spanish remains the only shipped locale in this phase, but new copy is centralized for later localization.

## Loading, Empty and Error States

- Initial loading uses structured skeleton cards rather than a blank page.
- Search refresh keeps existing results visible with a small progress indicator.
- Empty results explain why and offer clear filters.
- Repository failures show a retry action and do not silently replace API data with demo data while API mode is enabled.
- Failed save/apply actions restore the prior state and display a concise message.
- Offline mode is not claimed; the UI states that a connection is required when the HTTP repository cannot be reached.

## Testing

Automated tests cover:

- Breakpoint classification at 390px, 834px and 1440px.
- Correct navigation type for each layout class.
- Search and combined filter behavior.
- Job selection on desktop and detail navigation on mobile.
- Saved-job and application state transitions.
- Empty, loading and repository error states.
- Accessibility labels for search, filters, navigation and job actions.
- No horizontal overflow at the three reference widths and at 320px.

Verification requires `flutter analyze`, the complete Flutter test suite, API tests and a production web build. Manual visual review covers Android-like mobile, iOS safe-area behavior, tablet portrait/landscape and desktop keyboard navigation.

## Delivery Boundary

This phase is complete when the approved discovery design is represented by real responsive Flutter widgets, every visible new control performs a local/demo action or is clearly disabled, and the same source compiles for Android, iOS and web. Platform builds are not considered production releases until signing, store configuration and production backend infrastructure are completed separately.
