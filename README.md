# Agency Hisab

Miragpur Indane Gas Agency Management System.

Development is phase-based. See `docs/DEVELOPMENT_PHASES.md` and `AGENTS.md`.

## Prerequisites

- Node.js 20+ (Node 24 works locally; Functions `engines` still targets 20)
- Java 17+ on `PATH` (Firebase Emulator Suite). Example install path: `C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot`
- Firebase CLI 13+ (`npm i -g firebase-tools`). Locally verified with 13.1.0 using `firebase-functions@4.9.0`

## Local setup

1. Copy `.env.example` to `.env.local` and fill Firebase web config.
2. Install packages: `npm install` and `npm --prefix functions install`
3. Build functions: `npm run build:functions`
4. Start emulators: `npm run emulators`
5. In another terminal, create the first admin against the emulators: `npm run bootstrap:admin`
6. If an older email-based admin already exists and must keep the same UID: `npm run migrate:admin-phone`
7. Start the web app: `npm run dev`

Bootstrap credentials are read from `.env.local` (`INITIAL_ADMIN_PHONE`, `INITIAL_ADMIN_PASSWORD`). Change them before any production use. See `docs/AUTHENTICATION.md`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server (emulators enabled via `.env.development`) |
| `npm run build` | Typecheck and production web build |
| `npm test` | Unit tests |
| `npm run test:rules` | Firestore rules tests (Firestore emulator must be running) |
| `npm run emulators` | Auth, Firestore, Functions, Storage emulators |
| `npm run bootstrap:admin` | One-time admin provisioning (emulator by default) |

## Security note

There is no public admin signup. Staff accounts are created only by an administrator through Cloud Functions.
