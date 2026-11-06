# Phase Quality Gate

Status: mandatory for every development phase after Phase 1.

A phase is **not** complete when its screens render. It is complete only when the checklist below is satisfied and recorded in `docs/CHANGELOG.md` and `docs/DEVELOPMENT_PHASES.md`.

## Required for every phase

1. **Requirements and acceptance criteria**  
   Written acceptance criteria before coding starts. Ambiguous rules are resolved with the product owner, not invented in code.

2. **Data model and migration**  
   Document schema changes, indexes, and how existing documents remain valid. Never delete production data to make a migration “easy”.

3. **Permission and authorization review**  
   Reuse `shared/rules/permissions.ts`. Update nav visibility, route guards, Cloud Functions, and Firestore rules together. Custom claims remain the source of role; profile fields are not trusted for elevation.

4. **Input validation**  
   Client validation for UX; shared Zod schemas and server-side checks for every privileged write. Money stays integer paise.

5. **Error and loading states**  
   Every form and query shows loading, failure, and retry where appropriate. Do not swallow Firebase/API errors.

6. **Empty states**  
   Distinguish “no data yet”, “unavailable until module exists”, and real zero totals. Never fabricate zeros for missing ledgers.

7. **Normal and edge-case tests**  
   Cover success, invalid input, empty data, unauthorized access, network failure, double submit, refresh/session, and relevant boundaries.

8. **Regression tests**  
   Existing auth, permissions, money/journal, and rules tests must stay green.

9. **Build and type-check**  
   `npm run typecheck`, `npm test`, relevant `npm run test:rules`, and `npm run build` must pass. Do not claim success without running them.

10. **Manual verification**  
    Short desktop + mobile checklist for the phase’s critical journeys (including permission combinations).

11. **Final completion report**  
    Root causes (if fixing defects), files changed, tests run with results, known limitations, and explicit stop before the next phase.

## Permission navigation rule

Staff see nav entries for permissions they hold. Unimplemented modules appear as non-link “Later phase” items. Only implemented modules expose working routes. Administrators see all entries. Settings and Users remain administrator-only unless a later phase deliberately adds a staff permission and route guard.

## Stop rule

Do not start the next phase without explicit approval after this gate is met.
