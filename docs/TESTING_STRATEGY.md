# Testing Strategy

Status: proposed. No tests exist yet. A test is reported as passed only after it has been executed in this environment.

## Tooling

| Kind | Tool | When it starts |
| --- | --- | --- |
| Unit | Vitest | Phase 1, expanded every phase |
| Component | React Testing Library | Phase 1 for shell and auth forms |
| Rules and functions | Firebase Emulator Suite, `@firebase/rules-unit-testing` | Phase 1 |
| End to end | Playwright | Phase 2 for import and customer search; each later workflow adds specs |
| Android | Capacitor on emulator or device | Phase 8, or a written gap if the SDK is absent |

Java is not installed on this machine. Emulator tests cannot run until a JDK is installed. That is a Phase 1 prerequisite, not a reason to skip the tests.

Emulator ports and `VITE_USE_EMULATORS` keep test data off the live `hisab-9d3e4` project. Tests must not point at production.

## What is unit-tested

Pure functions in `shared/calculations`:

- Paise arithmetic, partial payment identity (received + due = sale).
- Journal balance check.
- Inventory deltas, transfer pairing, negative-stock guard.
- Obligation settlement: money versus empty cylinder.
- Pre-returned empty matching, including partial quantity.
- Payment allocation and aging buckets.
- Commission selection by effective date.
- Reversal compensation.
- “Business date is today” in `Asia/Kolkata`.

## What is integration-tested

Against emulators, with Auth users who actually hold admin and staff claims:

- Privileged collections reject client SDK writes.
- A caller cannot grant themselves admin.
- Godown sale posts once and is readable in register, ledgers, balances, and obligations under one id.
- The same idempotency key returns the original id and does not add lines.
- Staff godown sale posts. Staff reversal is denied. Admin reversal works only for today’s business date.
- Pending staff expenses do not change balances until approval.
- Locked-day writes are rejected.

## Invariants that must have an automated test before the product is called complete

1. A godown sale appears exactly once in each affected module.
2. A partial payment leaves the correct outstanding paise.
3. An empty return reduces the matching empty obligation only.
4. A pre-returned empty is not counted twice when the filled cylinder is collected.
5. A stock transfer does not create revenue.
6. A UPI collection does not change the cash balance.
7. Reversal reverses the original financial and stock effects.
8. A past business date cannot be removed with the today-only delete action.
9. A historical correction keeps the original transaction.
10. A retry does not double-post.
11. Staff cannot run admin-only operations.
12. A locked day cannot be edited by an ordinary write.
13. Every posted journal balances.
14. Inventory movements reconcile to balances.

## How a phase is verified

1. Run the unit tests for calculations touched in that phase.
2. Run emulator tests for the new callables and rules.
3. Run the Vite production build.
4. Exercise the new screens in a browser at desktop width and at a phone width: main path, empty state, validation error, and permission denial.
5. Record commands and results in the phase completion report. Failures stay listed until fixed. Skipped checks are listed as not run.

Playwright covers the same primary paths once the module is stable enough that selectors will not churn every hour. It does not replace the manual responsive pass.
