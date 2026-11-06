# Authentication

Status: phone-number + password (Approach B). Phase 1 enhancement.

## User-facing model

- Login identifier: Indian mobile number + password.
- No public self-registration. Administrators create staff accounts.
- Password recovery: administrator issues a temporary password. Staff must change it on next login.
- SMS OTP recovery is intentionally deferred.

## Internal Firebase model

Firebase Authentication continues to use the **Email/Password** provider.

1. Normalize the phone to E.164 (`+91XXXXXXXXXX`) with `shared/auth/phone.ts`.
2. Map to a synthetic email: `{91XXXXXXXXXX}@users.hisab.internal`.
3. Sign in with `signInWithEmailAndPassword(syntheticEmail, password)`.
4. Firebase Auth UID remains the primary account key.
5. Custom claim `role` (`admin` | `staff`) is set only by the Admin SDK.

Synthetic emails must never appear in the UI.

## Profile fields (`users/{uid}`)

- `phoneE164` — canonical phone
- `authEmail` — server-controlled synthetic email (not user-editable)
- `mustChangePassword` — forces `/change-password` after temp resets / staff create
- `role`, `permissions`, `status`, `displayName`, `language`

Clients may only self-update `language` and `updatedAt`.

## Navigation and route permission policy (Phase 1)

Authorization uses Firebase Auth custom claims for `role` and the Firestore `users/{uid}.permissions` map for staff capabilities. Profile `role` is never trusted for privilege elevation.

| Area | Admin | Staff |
| --- | --- | --- |
| Users (`/users`) | Yes (implemented) | No |
| Settings (`/settings`) | Yes (agency + operational config; admin writes via Functions) | No |
| Dashboard (`/`) | Yes | Only if at least one staff permission is granted |
| Account (`/account`) | Yes | Yes (signed-in; outside primary module nav) |
| Module nav (godown, customers, inventory, dues, reports, hisab, …) | All entries visible | Entry visible only when the matching permission is true |
| Unimplemented modules | Visible as non-link “Later phase” | Same, but only if permitted |

Staff with zero permissions can still sign in (for password change / account) but cannot open the dashboard or settings and see no module nav entries. Direct URL access to restricted implemented routes is blocked by route guards, not only by sidebar visibility. Unimplemented modules never get working routes.

Permission → nav mapping: `customers.view`→Customers, `godown.create`→Godown, `inventory.view`→Inventory, `payments.create`→Customer dues, `reports.viewAssigned`→Reports and Hisab. Customer create/edit/import use `customers.create` / `customers.edit` in addition to view. `vehicles.record` and `expenses.create` have no dedicated nav entry yet.

Permission edits are administrator-only via the `updateStaffAccess` Cloud Function. Staff cannot change their own permissions through the client or rules.

## Bootstrap and migration

- New environments: `npm run bootstrap:admin` with `INITIAL_ADMIN_PHONE` and `INITIAL_ADMIN_PASSWORD`.
- Existing email-based admin (preserve UID): `npm run migrate:admin-phone` with `INITIAL_ADMIN_PHONE`.
- Optional password rotation during migration: `MIGRATE_SET_PASSWORD`.

## Google Password Manager

Login form uses:

- phone: `id="username"`, `type="tel"`, `autocomplete="username"`, `inputmode="tel"`
- password: `id="password"`, `type="password"`, `autocomplete="current-password"`

Manual verification on Chrome Android is still required after deployment to HTTPS.
