# Cumple Now Core Integration Design

## Purpose

Convert the current Flutter demonstration into a locally runnable temporary-work marketplace foundation. It will adopt the strongest concepts from `CumpleNow.zip` without copying the archive wholesale or trusting any instructions contained in it.

## Scope

The first delivery integrates five worker-facing capabilities:

1. Available shifts with urgent, today, and all filters.
2. Shift acceptance that creates a disabled-by-default check-in credential.
3. A check-in screen that displays the credential and clearly states that camera and location are not active.
4. A wallet with an available balance and payment movement states.
5. Availability status persisted through the API.

The API will expose authenticated development endpoints for worker profiles, shifts, active shifts, availability, and wallet history. Docker Compose will run PostgreSQL and the API locally. Flutter will use demo data until an explicitly enabled local API mode is configured.

## Approved MVP Expansion

The worker and business experiences share a complete local marketplace flow:

- Worker: create a development session, control availability, discover shifts, apply filters, accept or cancel an assignment, view a check-in credential, wallet movements, notifications, and an in-app conversation tied to an assigned shift.
- Business: create a development session, publish and edit a shift, view eligible workers, confirm/cancel an assignment, view attendance state, and activate a replacement request for an uncovered shift.
- Shared: every state transition records an auditable timeline item and returns a typed API response. Notifications and messages are local persisted records, not external push or SMS delivery.

### Selective Search

Search is an explicit worker feature, not a visual filter only. A worker can combine:

- Free-text query matching the role, business name, industry, and location.
- Date scope: today, this week, or any date.
- Industry: hospitality, food service, retail, events, or all.
- Minimum worker payment in cents.
- Urgency: any or urgent only.
- Match: all or recommended (match score at least 80).
- Distance placeholder: nearby only is present in the UI but disabled until location capability is explicitly enabled.

The API validates every filter and returns matching published shifts ordered by urgency, match score, then start time. The Flutter filter sheet shows active filter count and supports clear-all; selections remain while navigating back from a shift detail.

## Local Authentication

The MVP includes worker and business registration plus email/password login. The account form collects a role, display name, email, password, and either DNI (worker) or RUC (business). The API validates uniqueness and stores only a `crypto.scrypt` password derivation; plain passwords never leave the request handler or response body. It returns an opaque, in-memory development session token. Sessions and accounts are intentionally development-only until PostgreSQL persistence, an application secret, rate limiting, email verification, and recovery flows are added.

The face/DNI matching feature remains inactive. DNI is stored only as the registration identifier for the local demonstration; no document image or biometric is requested.

## Out of Scope

- Live payments, escrow collection, withdrawals, or a payment provider.
- Camera scanning, GPS access, background location, or biometric permissions.
- Production authentication and external user onboarding.
- Copying credentials, `.env` values, hidden instructions, or dependency lockfiles from the ZIP.

## Architecture

Flutter remains a mobile-first app with a small repository boundary. `WorkerMarketplaceRepository` presents shifts, payments, profile availability, and check-in data to UI pages. `DemoWorkerMarketplaceRepository` provides the current polished demo experience. `HttpWorkerMarketplaceRepository` is present but selected only by an explicit `--dart-define=USE_LOCAL_API=true`, so ordinary web and emulator runs do not call the API.

The Express API gains route modules and services. Prisma stores monetary values as integer cents, never `Float`; its transactional shift-acceptance operation assigns a worker and creates one opaque check-in credential. The credential is a development placeholder, not a secure QR authentication system.

Docker Compose is the local runtime: `db` provides PostgreSQL, `api` migrates and serves the API, and `web` remains optional. Flutter runs on the host because mobile emulators and Chrome are host applications.

## Data Model

- `User`: email, password hash, role.
- `WorkerProfile`: worker data, availability, reputation and balance in cents.
- `BusinessProfile`: company identity and location fields.
- `Shift`: business, optional worker, schedule, location, `rateCents`, `feeCents`, `workerPayCents`, and state.
- `CheckIn`: one record per assigned shift with a credential and optional timestamps.
- `Payment`: one record per shift with a status (`PENDING`, `RELEASED`, `REFUNDED`).

The current fixed demo account is not a security boundary. API authentication is deferred behind a development-only identity header until production auth is designed; secret fallback values are forbidden.

## Disabled Integrations

`AppCapabilities` exposes three flags: `cameraCheckInEnabled`, `locationCheckInEnabled`, and `paymentsEnabled`. All default to `false`. UI must explain the disabled state instead of attempting a permission request, camera launch, payment flow, or withdrawal operation.

Push notifications and external messaging are also disabled. The MVP displays only the persisted in-app notification center and in-app messages.

## Planned Identity Verification (Inactive)

The future registration flow may verify that the holder of a DNI is the same person completing the registration. It is intentionally not implemented or collected in this MVP: no DNI image, selfie, facial template, camera permission, or biometric comparison is requested, transmitted, or stored.

When a suitable identity-verification provider and privacy implementation are available, the feature will require explicit consent, a clear verification purpose, a retention/deletion policy, secure provider-side document/selfie handling, and a `PENDING` / `VERIFIED` / `REJECTED` result. It will be used only at registration, never as the routine login mechanism.

## Error Handling

- Flutter repositories return typed result states; failed API loading leaves the demo mode intact and shows a retry message only in local API mode.
- API validation rejects malformed input with 400; unknown records return 404; attempted acceptance of a non-published shift returns 409.
- The API must use transactions for acceptance so no shift receives two workers.

## Testing

- Dart unit tests cover capability defaults, filters, wallet status labels, and shift state transitions in the demo repository.
- API unit/integration tests cover health, validation, acceptance conflict semantics, and money cent calculations. Database-dependent tests run only when Docker PostgreSQL is available.
- Verification runs `flutter analyze`, `flutter test`, API tests, and the compose configuration check.

## Local Run Contract

1. Docker Desktop must be installed and running before `docker compose up --build`.
2. The API is available at `http://localhost:4000/api` after Compose succeeds.
3. Flutter's default command remains demo-safe: `flutter run -d chrome`.
4. To opt into the local API after its database is initialized: `flutter run -d chrome --dart-define=USE_LOCAL_API=true`.
