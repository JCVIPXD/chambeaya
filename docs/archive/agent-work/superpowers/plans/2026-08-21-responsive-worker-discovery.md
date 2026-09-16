# Responsive Worker Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-ready responsive Flutter worker discovery experience with functional demo search, filters, saved jobs, applications and mobile/tablet/desktop navigation.

**Architecture:** Flutter classifies viewport width through a pure responsive utility and renders one shared worker state inside platform-specific shells. Discovery behavior stays behind an extended repository interface so demo data and the HTTP implementation share the same UI contract; presentation widgets never perform HTTP directly.

**Tech Stack:** Flutter 3.44, Dart 3.12, Material 3, Flutter widget/unit tests, existing Express API for optional local data.

**Spec:** `docs/superpowers/specs/2026-08-21-responsive-worker-discovery-design.md`

## Global Constraints

- Preserve navy `#1A2B4A`, teal `#00C896`, soft teal `#E4FAF4`, background `#F0F3F8`, border `#D9E2EC` and Inter/system sans typography.
- Mobile is below 600 logical pixels, tablet is 600–1023, and desktop is 1024 or wider.
- New controls have 48px minimum touch targets and semantic labels.
- Camera, GPS, production payments and biometric verification remain disabled.
- Demo application actions never contact a real employer.
- API money remains integer cents and is formatted only in presentation code.

---

### Task 1: Responsive foundation and adaptive shell

**Files:**
- Create: `apps/mobile_flutter/lib/core/responsive/app_breakpoints.dart`
- Create: `apps/mobile_flutter/lib/core/navigation/worker_destination.dart`
- Create: `apps/mobile_flutter/lib/core/navigation/adaptive_worker_scaffold.dart`
- Modify: `apps/mobile_flutter/lib/features/marketplace/worker_shell.dart`
- Test: `apps/mobile_flutter/test/responsive_shell_test.dart`

**Interfaces:**
- Produces `AppLayoutClass { mobile, tablet, desktop }` and `classifyLayout(double width)`.
- Produces `AdaptiveWorkerScaffold(selectedIndex, onDestinationSelected, body)`.
- Worker destinations are `Inicio`, `Buscar`, `Postulaciones`, `Mensajes`, `Perfil`.

- [ ] **Step 1: Write failing responsive tests**

```dart
expect(classifyLayout(390), AppLayoutClass.mobile);
expect(classifyLayout(834), AppLayoutClass.tablet);
expect(classifyLayout(1440), AppLayoutClass.desktop);
```

Add widget assertions that 390px renders `NavigationBar`, 834px renders `NavigationRail`, and 1440px renders a sidebar containing `Cumple Now` and `Postulaciones`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `flutter test test/responsive_shell_test.dart`

Expected: compilation failure because responsive types do not exist.

- [ ] **Step 3: Implement breakpoint classifier, destination model and adaptive scaffold**

Use `LayoutBuilder` once in `AdaptiveWorkerScaffold`. Preserve `selectedIndex` when width changes. Use safe areas on mobile, an 80px rail on tablet and a 240px sidebar on desktop.

- [ ] **Step 4: Bind `WorkerShell` to the adaptive scaffold**

Keep its active shift state. Replace the existing fixed bottom navigation with `AdaptiveWorkerScaffold` without changing repository ownership.

- [ ] **Step 5: Verify GREEN**

Run: `flutter test test/responsive_shell_test.dart`

Expected: all responsive shell tests pass.

### Task 2: Discovery models and functional demo state

**Files:**
- Create: `apps/mobile_flutter/lib/features/discovery/discovery_models.dart`
- Create: `apps/mobile_flutter/lib/features/discovery/discovery_controller.dart`
- Modify: `apps/mobile_flutter/lib/features/marketplace/marketplace_repository.dart`
- Modify: `apps/mobile_flutter/lib/features/marketplace/http_worker_marketplace_repository.dart`
- Test: `apps/mobile_flutter/test/discovery_controller_test.dart`

**Interfaces:**
- Produces `ApplicationState { notApplied, submitted, reviewing, accepted, closed }`.
- Produces immutable `DiscoveryState` with query, filter, selected job, saved IDs and application map.
- Produces `DiscoveryController` methods `setQuery`, `setUrgentOnly`, `setRecommendedOnly`, `selectShift`, `toggleSaved`, `applyToShift` and `clearFilters`.

- [ ] **Step 1: Write failing state-transition tests**

```dart
controller.toggleSaved('shift-la-mar');
expect(controller.state.savedShiftIds, contains('shift-la-mar'));
controller.applyToShift('shift-la-mar');
expect(controller.state.applicationStates['shift-la-mar'], ApplicationState.submitted);
```

Also verify combined query and urgent filters, clear-all, and selection preservation.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `flutter test test/discovery_controller_test.dart`

Expected: compilation failure because discovery models do not exist.

- [ ] **Step 3: Implement immutable state and controller**

Use existing `ShiftSearchFilter` and `filterDemoShifts`. Notify listeners synchronously after each local transition. Reject applying to an unknown shift by leaving state unchanged and exposing a concise error message.

- [ ] **Step 4: Extend repository contracts without external side effects**

Add typed local operations for saved IDs and application states. Demo mode stores them in memory. HTTP mode reports these actions as development-local until API persistence is added; it must not call a real employer or payment provider.

- [ ] **Step 5: Verify GREEN**

Run: `flutter test test/discovery_controller_test.dart test/marketplace_repository_test.dart`

Expected: all discovery and repository tests pass.

### Task 3: Client-ready worker discovery interface

**Files:**
- Create: `apps/mobile_flutter/lib/features/discovery/worker_discovery_page.dart`
- Create: `apps/mobile_flutter/lib/features/discovery/widgets/discovery_header.dart`
- Create: `apps/mobile_flutter/lib/features/discovery/widgets/job_search_bar.dart`
- Create: `apps/mobile_flutter/lib/features/discovery/widgets/job_filter_controls.dart`
- Create: `apps/mobile_flutter/lib/features/discovery/widgets/job_card.dart`
- Create: `apps/mobile_flutter/lib/features/discovery/widgets/job_detail_panel.dart`
- Create: `apps/mobile_flutter/lib/features/discovery/widgets/client_demo_banner.dart`
- Modify: `apps/mobile_flutter/lib/features/marketplace/worker_shell.dart`
- Test: `apps/mobile_flutter/test/worker_discovery_page_test.dart`

**Interfaces:**
- `WorkerDiscoveryPage(repository)` owns a `DiscoveryController` and composes all discovery widgets.
- `JobCard` accepts `Shift`, saved/application state and callbacks.
- `JobDetailPanel` accepts a selected `Shift` and apply/save callbacks.
- `ClientDemoBanner` labels demo data and provides three deterministic scenarios: normal results, empty results and simulated connection error.

- [ ] **Step 1: Write failing widget tests**

At 390px assert the greeting, search, recommended card, demo label and bottom navigation are visible without overflow. At 1440px assert sidebar, results and selected job detail appear simultaneously. Tap save and apply, then assert `Guardado` and `Postulación enviada` states.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `flutter test test/worker_discovery_page_test.dart`

Expected: compilation failure because discovery widgets do not exist.

- [ ] **Step 3: Implement mobile discovery composition**

Use one column, horizontal filter chips, full-width job cards and a detail route/sheet. Keep each action at least 48px and add semantic labels for search, filters, save and apply.

- [ ] **Step 4: Implement tablet and desktop composition**

Tablet uses a rail and two-column cards. Desktop uses the 240px sidebar, a 400px results column and a flexible sticky detail panel. Constrain the workspace to 1440px and prevent horizontal overflow at 1024px.

- [ ] **Step 5: Add deterministic client demo states**

The banner must state `Datos de demostración`. Scenario controls alter only local presentation state and make progress easy to demonstrate without Docker or a production backend.

- [ ] **Step 6: Verify GREEN**

Run: `flutter test test/worker_discovery_page_test.dart test/responsive_shell_test.dart`

Expected: all responsive discovery widget tests pass.

### Task 4: Polish, documentation and distributable client preview

**Files:**
- Modify: `apps/mobile_flutter/lib/theme/app_theme.dart`
- Modify: `apps/mobile_flutter/lib/main.dart`
- Modify: `README.md`
- Create: `docs/CLIENT_DEMO.md`
- Test: `apps/mobile_flutter/test/accessibility_smoke_test.dart`

**Interfaces:**
- Produces reusable input, button, chip, card and navigation theme defaults.
- Produces a client demo guide with worker registration credentials, visible scenarios and limitations.

- [ ] **Step 1: Write failing accessibility and overflow smoke tests**

Render the app at 320px, 390px, 834px and 1440px. Assert no exceptions and confirm semantic labels for `Buscar empleos`, `Abrir filtros`, `Guardar empleo` and `Postular ahora`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `flutter test test/accessibility_smoke_test.dart`

Expected: failure until all labels and width protections exist.

- [ ] **Step 3: Polish the shared Material theme**

Centralize `InputDecorationTheme`, `FilledButtonThemeData`, chip styling, card styling, focus colors and text scale behavior using only approved design tokens.

- [ ] **Step 4: Write the client demonstration guide**

Document startup at `http://localhost:7357`, worker registration, search/filter/save/apply steps, mobile/tablet/desktop browser widths, and clear labels for disabled payments, camera, GPS, biometrics and real employer contact.

- [ ] **Step 5: Run complete verification and build**

Run: `flutter analyze`

Run: `flutter test`

Run: `flutter build web --release --dart-define=USE_LOCAL_API=true`

Run: `npm --workspace @cumple-now/api test && npm --workspace @cumple-now/api run build`

Expected: every command exits successfully with zero test failures and no analysis or TypeScript errors.
