# AGENTS.md — Indane Gas Agency Management System

## 1. Primary Objective

Build a reliable, production-ready Indane Gas Agency Management System while minimizing unnecessary AI usage, context consumption, repeated code generation, and avoidable development work.

Every implementation must prioritize:
- Correctness
- Data integrity
- Financial accuracy
- Inventory accuracy
- Security
- Maintainability
- Performance
- Mobile and desktop usability

Do not sacrifice correctness or testing to save AI usage.

## 2. AI Usage and Cost Optimization Rules

Follow these rules throughout the project:

1. Read the relevant existing files before making changes.
2. Never read the entire repository when only a specific module is relevant.
3. Never regenerate entire files or modules when a targeted modification is sufficient.
4. Never rewrite working code without a clear technical reason.
5. Reuse existing components, utilities, hooks, services, types, schemas, and patterns.
6. Do not create duplicate components, helpers, API services, or business logic.
7. Do not install new dependencies without first checking whether existing dependencies can solve the requirement.
8. Avoid unnecessary third-party libraries.
9. Do not create multiple alternative implementations unless explicitly requested.
10. Do not repeatedly explain the same architecture or requirements.
11. Maintain concise implementation notes and update documentation only when relevant.
12. Before making changes, identify the exact files that need modification.
13. Group related changes into a single coherent implementation instead of making unnecessary small edits.
14. Do not modify unrelated modules.
15. Do not run expensive or redundant operations without a reason.
16. Never repeatedly execute the same failing command without diagnosing its root cause.
17. Use local terminal commands for deterministic checks whenever possible.
18. Do not ask an AI model to perform work that a simple terminal command, existing script, or deterministic test can perform.
19. Preserve useful findings from previous debugging sessions so the same investigation is not repeated.
20. If the task is unclear, ask one focused clarification question rather than making assumptions and generating unnecessary code.

## 3. Mandatory Development Workflow

For every task:

### Step 1 — Understand
- Read the relevant requirements and existing implementation.
- Identify dependencies and affected modules.
- Check existing types, services, components, and tests.
- Identify possible data-integrity or security implications.

### Step 2 — Plan
Before implementation, provide a concise plan containing:
- Objective
- Files to create
- Files to modify
- Existing functionality to reuse
- Important risks
- Tests to execute

For small, unambiguous changes, use a short plan.

Do not produce lengthy explanations for routine tasks.

### Step 3 — Implement
- Make the smallest complete implementation.
- Follow existing architectural conventions.
- Keep business logic separate from presentation.
- Prefer reusable, typed functions.
- Avoid unnecessary abstractions.
- Keep components focused.
- Avoid `any` unless there is a documented technical justification.
- Use strict TypeScript wherever possible.

### Step 4 — Validate
Run the relevant local checks:
- TypeScript
- ESLint
- Unit tests
- Integration tests
- Firebase Emulator tests
- Production build

Do not run every test suite after every minor change. Select tests based on the affected functionality.

Run the full relevant suite at phase completion.

### Step 5 — Report
Provide a concise summary:
- What was implemented
- Files created or modified
- Tests executed
- Test results
- Known issues
- Remaining work

Do not claim that something works unless it has been verified.

## 4. Architecture and Code Quality

- Follow the approved project architecture.
- Prefer existing conventions over introducing new patterns.
- Keep Firebase access inside the appropriate service/repository layer.
- Keep UI components independent of database implementation details.
- Keep business calculations in testable domain functions.
- Use centralized validation schemas.
- Use shared types and constants.
- Avoid duplicate business rules across frontend and backend.
- Use server-side validation for every important operation.
- Never trust frontend calculations for financial or inventory operations.
- Avoid unnecessary client-side state.
- Keep components small and focused without creating excessive fragmentation.

## 5. Financial and Inventory Integrity

This is a business-critical application.

Mandatory rules:

1. Store money as integer paise, not floating-point currency values.
2. Maintain immutable posted financial transactions.
3. Use unique transaction IDs.
4. Make financial and inventory operations atomic.
5. Implement idempotency for retryable operations.
6. Prevent duplicate transactions.
7. Maintain an auditable ledger.
8. Recalculate balances using verified ledger entries.
9. Never silently overwrite financial history.
10. Use compensating transactions for reversals.
11. Validate stock availability before dispatch.
12. Validate customer dues and outstanding balances.
13. Maintain separate filled-cylinder and empty-cylinder quantities.
14. Handle concurrent transactions safely.
15. Never assume that a successful frontend request means a transaction was committed.

## 6. Transaction Reversal and Historical Correction

Follow the approved business rules:

- Only administrators can reverse today's godown entries.
- Eligibility is determined by business date in the agency timezone.
- Staff members cannot reverse transactions.
- Reversal requires a reason and two separate confirmations.
- Reversal must immediately correct all related financial and inventory effects.
- Preserve the original transaction.
- Create a compensating reversal transaction.
- Maintain administrator ID, timestamp, reason, original ID, and reversal ID.
- Past transactions must use the Historical Correction workflow.
- Never physically delete posted financial or inventory transactions.
- Preserve original closing snapshots and report corrections separately.
- Apply all changes atomically.

## 7. Security

- Enforce permissions in backend logic and Firestore Security Rules.
- Never rely only on frontend role checks.
- Validate every user input.
- Protect sensitive customer information.
- Never expose secrets, API keys, private credentials, or Firebase Admin credentials in client code.
- Use environment variables appropriately.
- Apply least-privilege access.
- Test unauthorized access scenarios.

## 8. Firebase and Database

- Avoid unnecessary database reads and writes.
- Use pagination for large collections.
- Avoid unbounded queries.
- Use transactions or batched writes where appropriate.
- Keep Firestore indexes documented.
- Avoid duplicated or denormalized data unless there is a clear performance or reporting reason.
- When denormalizing data, maintain consistency through controlled backend operations.
- Handle offline writes through a documented synchronization strategy.
- Make synchronization retry-safe.
- Never assume offline data has already been committed to the backend.

## 9. Testing Rules

Tests are mandatory for business-critical operations.

Prioritize:
- Money calculations
- Stock calculations
- Ledger consistency
- Transaction reversals
- Historical corrections
- Duplicate prevention
- Role permissions
- Concurrent updates
- Offline synchronization
- Daily closing and reconciliation

For each bug:
1. Reproduce it.
2. Identify the root cause.
3. Fix the root cause.
4. Add a regression test.
5. Verify the fix.

Do not add meaningless tests simply to increase test count.

## 10. Dependency Management

Before installing a package:
- Check package.json.
- Check whether the functionality already exists.
- Prefer native browser, JavaScript, TypeScript, React, or Firebase capabilities when sufficient.
- Explain why a new package is necessary.
- Install only the required package.

Do not upgrade unrelated packages.

## 11. Documentation

Maintain only useful documentation.

Update:
- Architecture documentation when architecture changes.
- Database documentation when schema changes.
- Business rules when approved requirements change.
- API documentation when endpoints change.
- Test documentation when validation procedures change.

Do not repeatedly regenerate documentation that has not changed.

## 12. Phase Management

The project must be developed in the approved phases.

- Work only on the currently approved phase.
- Do not start future phases automatically.
- Do not introduce future-phase features prematurely.
- Complete implementation and relevant testing before reporting a phase as complete.
- Document blockers and unresolved issues.
- Stop and wait for explicit approval before proceeding.

## 13. Prohibited Practices

Never:
- Generate the whole application in one response.
- Rewrite working modules unnecessarily.
- Delete existing functionality without approval.
- Invent business rules.
- Use mock data as a substitute for real functionality in production.
- Hardcode financial balances.
- Ignore TypeScript errors.
- Ignore failing tests.
- Bypass security rules to make a feature work.
- Physically delete posted ledger transactions.
- Claim completion without verification.
- Make broad refactors unrelated to the approved task.

## 14. Response Format

Keep responses concise and structured.

For implementation tasks, report:

### Completed
- ...

### Files Changed
- ...

### Validation
- ...

### Issues / Remaining Work
- ...

### Next Step
- ...

Avoid lengthy explanations unless requested.

**Final principle:** Use the least amount of AI assistance necessary to implement the complete requirement correctly. Never reduce the quality, security, or reliability of the application merely to reduce AI usage.