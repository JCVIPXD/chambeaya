# Cumple Now Core Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Flutter marketplace and the local API support demo-safe shifts, availability, check-in credentials, and wallet movements, with Docker Compose as the local backend runtime.

**Architecture:** Flutter receives an explicit repository boundary and always starts in demo mode unless `USE_LOCAL_API=true` is supplied. Express gains focused modules, backed by a cents-based Prisma schema; protected integrations remain represented as disabled capabilities only. Docker runs PostgreSQL and API; Flutter stays on the host.

**Tech Stack:** Flutter/Dart, Flutter test, Express 5, TypeScript, Zod, Prisma/PostgreSQL, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-21-cumple-now-core-design.md`

## Global Constraints

- Use `int` cents for money in the API; no `Float`/`double` monetary persistence.
- Camera check-in, location check-in, and payments default to `false` and must not request permissions or perform an external action.
- Flutter must run safely without Docker using the demo repository.
- Local API usage requires `--dart-define=USE_LOCAL_API=true`.
- Do not copy secrets or configuration from `CumpleNow.zip`.

---

### Task 1: Establish Flutter marketplace domain and disabled capabilities

**Files:**
- Create: `apps/mobile_flutter/lib/features/marketplace/marketplace_repository.dart`
- Create: `apps/mobile_flutter/lib/features/marketplace/app_capabilities.dart`
- Create: `apps/mobile_flutter/test/marketplace_repository_test.dart`
- Modify: `apps/mobile_flutter/lib/features/marketplace/marketplace_data.dart`

**Interfaces:**
- Produces `AppCapabilities.defaults`, `WorkerMarketplaceRepository`, `DemoWorkerMarketplaceRepository`, `ShiftState`, and `WalletMovement`.
- Consumes the existing `Shift` and `PaymentRecord` presentation models.

- [ ] **Step 1: Write the failing tests**

```dart
test('all protected capabilities are disabled by default', () {
  expect(AppCapabilities.defaults.cameraCheckInEnabled, isFalse);
  expect(AppCapabilities.defaults.locationCheckInEnabled, isFalse);
  expect(AppCapabilities.defaults.paymentsEnabled, isFalse);
});

test('accepting a published demo shift produces an assigned check-in credential', () async {
  final repository = DemoWorkerMarketplaceRepository();
  final accepted = await repository.acceptShift('shift-la-mar');
  expect(accepted.state, ShiftState.assigned);
  expect(accepted.checkInCredential, startsWith('DEMO-CUMPLE-'));
});
```

- [ ] **Step 2: Run the Flutter test and verify it fails**

Run: `flutter test test/marketplace_repository_test.dart`

Expected: FAIL because the capabilities and repository types do not yet exist.

- [ ] **Step 3: Implement the smallest domain boundary**

```dart
abstract interface class WorkerMarketplaceRepository {
  Future<List<Shift>> availableShifts();
  Future<Shift> acceptShift(String shiftId);
  Future<List<WalletMovement>> walletMovements();
}

class AppCapabilities {
  const AppCapabilities({required this.cameraCheckInEnabled, required this.locationCheckInEnabled, required this.paymentsEnabled});
  static const defaults = AppCapabilities(cameraCheckInEnabled: false, locationCheckInEnabled: false, paymentsEnabled: false);
}
```

- [ ] **Step 4: Run the focused Flutter test and verify it passes**

Run: `flutter test test/marketplace_repository_test.dart`

Expected: PASS.

### Task 2: Bind Flutter screens to the demo-safe marketplace flow

**Files:**
- Modify: `apps/mobile_flutter/lib/features/marketplace/worker_pages.dart`
- Modify: `apps/mobile_flutter/lib/features/marketplace/worker_shell.dart`
- Create: `apps/mobile_flutter/test/worker_flow_test.dart`

**Interfaces:**
- Consumes `DemoWorkerMarketplaceRepository`, `AppCapabilities`, `ShiftState`, and `WalletMovement` from Task 1.
- Produces UI that accepts a demo shift, presents an assigned credential, and labels disabled integrations.

- [ ] **Step 1: Write the failing widget test**

```dart
testWidgets('check-in screen communicates that camera verification is disabled', (tester) async {
  await tester.pumpWidget(const CumpleNowApp());
  await tester.tap(find.text('Check-in'));
  await tester.pumpAndSettle();
  expect(find.textContaining('Cámara desactivada'), findsOneWidget);
});
```

- [ ] **Step 2: Run the widget test and verify it fails**

Run: `flutter test test/worker_flow_test.dart`

Expected: FAIL because the disabled message is absent.

- [ ] **Step 3: Implement screen state and actions**

```dart
if (!capabilities.cameraCheckInEnabled) {
  return const Text('Cámara desactivada: tu código se mostrará cuando tengas un turno asignado.');
}
```

Add an `Aceptar turno` action that calls `acceptShift`, refreshes the list, and makes the check-in tab show the returned credential. Render wallet movement statuses as `Pendiente`, `Liberado`, or `Reembolsado`; keep withdrawals disabled with explanatory copy.

- [ ] **Step 4: Run Flutter analysis and all Flutter tests**

Run: `flutter analyze && flutter test`

Expected: no analysis issues and all tests PASS.

### Task 3: Implement API domain and local development endpoints

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/modules/marketplace/marketplace.service.ts`
- Create: `apps/api/src/modules/marketplace/marketplace.routes.ts`
- Create: `apps/api/src/modules/marketplace/marketplace.schemas.ts`
- Create: `apps/api/src/modules/marketplace/marketplace.service.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces `GET /api/shifts`, `PUT /api/shifts/:id/accept`, `GET /api/shifts/active`, `PUT /api/workers/availability`, and `GET /api/workers/wallet`.
- Uses header `x-demo-worker-id` only in development, with an explicit seed worker id.

- [ ] **Step 1: Write failing API tests**

```ts
it('returns a conflict when an already assigned shift is accepted', async () => {
  const first = await service.acceptShift('worker-a', 'shift-a');
  expect(first.status).toBe('ASSIGNED');
  await expect(service.acceptShift('worker-b', 'shift-a')).rejects.toMatchObject({ statusCode: 409 });
});

it('computes a worker payment entirely in cents', () => {
  expect(splitPaymentCents(10000, 10)).toEqual({ feeCents: 1000, workerPayCents: 9000 });
});
```

- [ ] **Step 2: Run API tests and verify they fail**

Run: `npm --workspace @cumple-now/api test`

Expected: FAIL because the service and `splitPaymentCents` do not yet exist.

- [ ] **Step 3: Implement schema, service, validation, and routes**

Use `Int` fields named `rateCents`, `feeCents`, `workerPayCents`, and `balanceCents`. Use a single `prisma.$transaction` for assignment and check-in credential creation. Validate `isAvailable` as a boolean and reject assignment when `status !== PUBLISHED` with HTTP 409. Do not add a default JWT secret, payment provider, camera route, or location route.

- [ ] **Step 4: Run API tests and TypeScript validation**

Run: `npm --workspace @cumple-now/api test && npm --workspace @cumple-now/api run build`

Expected: PASS with no TypeScript errors.

### Task 4: Connect opt-in Flutter HTTP repository and document Docker use

**Files:**
- Create: `apps/mobile_flutter/lib/features/marketplace/http_worker_marketplace_repository.dart`
- Modify: `apps/mobile_flutter/lib/main.dart`
- Modify: `apps/api/Dockerfile.dev`
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Create: `apps/mobile_flutter/test/api_mode_test.dart`

**Interfaces:**
- Consumes API endpoints from Task 3 and `USE_LOCAL_API` compile-time configuration.
- Produces demo mode as default and HTTP mode only when the define is true.

- [ ] **Step 1: Write the failing configuration test**

```dart
test('the default repository is demo-safe', () {
  expect(createWorkerMarketplaceRepository(useLocalApi: false), isA<DemoWorkerMarketplaceRepository>());
});
```

- [ ] **Step 2: Run the configuration test and verify it fails**

Run: `flutter test test/api_mode_test.dart`

Expected: FAIL because the repository factory does not exist.

- [ ] **Step 3: Add the opt-in HTTP repository and Docker startup behavior**

```dart
const useLocalApi = bool.fromEnvironment('USE_LOCAL_API', defaultValue: false);
final repository = createWorkerMarketplaceRepository(useLocalApi: useLocalApi);
```

Docker API startup must run Prisma generation and migration before starting the development server. README must list Docker Desktop as a prerequisite and distinguish `docker compose up --build` from Flutter host commands.

- [ ] **Step 4: Verify all application checks**

Run: `flutter analyze && flutter test && npm --workspace @cumple-now/api test && docker compose config`

Expected: all local checks PASS; `docker compose config` is permitted to be blocked only until Docker Desktop is installed and running.

### Task 5: Add selective shift search to API and Flutter

**Files:**
- Create: `apps/api/src/modules/marketplace/shift_search.ts`
- Create: `apps/api/tests/shift_search.test.ts`
- Modify: `apps/api/src/modules/marketplace/marketplace.service.ts`
- Modify: `apps/api/src/modules/marketplace/marketplace.routes.ts`
- Modify: `apps/mobile_flutter/lib/features/marketplace/marketplace_data.dart`
- Modify: `apps/mobile_flutter/lib/features/marketplace/marketplace_repository.dart`
- Modify: `apps/mobile_flutter/lib/features/marketplace/http_worker_marketplace_repository.dart`
- Modify: `apps/mobile_flutter/lib/features/marketplace/worker_pages.dart`
- Create: `apps/mobile_flutter/test/shift_search_test.dart`

**Interfaces:**
- Produces `ShiftSearchFilter`, `filterShifts(shifts, filter)`, and `GET /api/shifts?q=&dateScope=&industry=&minPayCents=&urgentOnly=&recommendedOnly=`.
- Adds a worker filter sheet and active-filter count; nearby filtering stays disabled because location is disabled.

- [ ] **Step 1: Write the failing API and Flutter tests**

```ts
it('returns urgent hospitality shifts matching a minimum worker pay', () => {
  const results = filterShifts(shifts, { industry: 'HOSPITALITY', urgentOnly: true, minPayCents: 9000 });
  expect(results.map((shift) => shift.id)).toEqual(['shift-la-mar']);
});
```

```dart
test('recommended search excludes shifts below the worker match threshold', () {
  final results = filterDemoShifts(availableShifts, const ShiftSearchFilter(recommendedOnly: true));
  expect(results.every((shift) => shift.match >= 80), isTrue);
});
```

- [ ] **Step 2: Run both focused tests and verify they fail**

Run: `npm --workspace @cumple-now/api test -- shift_search.test.ts` and `flutter test test/shift_search_test.dart`

Expected: FAIL because search models and filtering functions do not exist.

- [ ] **Step 3: Implement deterministic filtering**

Implement exact normalization for free text, enum/date validation for API query values, `minPayCents` integer validation, and ordering by urgent first, match descending, then title. Keep `nearbyOnly` only as a disabled UI control with an explanatory label.

- [ ] **Step 4: Add the filter sheet and repository query propagation**

Use `showModalBottomSheet` for role/business text search, industry chips, date scope, minimum payment, urgency, recommended, reset, and apply actions. API mode serializes only active filters to query parameters; demo mode uses the same `ShiftSearchFilter` function locally.

- [ ] **Step 5: Verify the complete search feature**

Run: `flutter analyze && flutter test && npm --workspace @cumple-now/api test && npm --workspace @cumple-now/api run build`

Expected: PASS with no analysis or TypeScript issues.

### Task 6: Add development login and role-based registration

**Files:**
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.routes.ts`
- Create: `apps/api/tests/auth.service.test.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/mobile_flutter/lib/features/auth/auth_page.dart`
- Create: `apps/mobile_flutter/test/auth_page_test.dart`
- Modify: `apps/mobile_flutter/lib/main.dart`

**Interfaces:**
- Produces `POST /api/auth/register` and `POST /api/auth/login` with `{ role, name, email, password, dniOrRuc }` and `{ email, password }`.
- Produces `AuthSession { token, role, name }` on valid authentication; passwords never appear in API responses.

- [ ] **Step 1: Write failing service and widget tests**

```ts
it('never exposes a plaintext password when registering a worker', () => {
  const session = service.register({ role: 'WORKER', name: 'Ana', email: 'ana@example.com', password: 'ClaveSegura1', dniOrRuc: '12345678' });
  expect(session).not.toHaveProperty('password');
});
```

```dart
testWidgets('registration requires a DNI for a worker', (tester) async {
  await tester.pumpWidget(const MaterialApp(home: AuthPage(role: AppAudience.worker)));
  expect(find.text('DNI'), findsOneWidget);
});
```

- [ ] **Step 2: Verify the new tests fail**, then implement the smallest in-memory local auth service, API routes, and Flutter form.

- [ ] **Step 3: Verify** `flutter analyze`, `flutter test`, `npm --workspace @cumple-now/api test`, and `npm --workspace @cumple-now/api run build`.
