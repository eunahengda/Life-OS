# LifeOS

A personal life management app: everything you own, everything important about your
life, everything you need to remember. Simple first, powerful when needed.

This repository currently contains **Task 001 — Project Foundation** and
**Task 002 — Supabase Database Foundation**: an app shell with placeholder
screens, plus the backend schema, RLS policies, and Supabase client. No
product UI or auth flows are wired up yet.

## Tech Stack

- React Native + [Expo](https://expo.dev)
- TypeScript
- [Expo Router](https://docs.expo.dev/router/introduction/) (file-based navigation)
- [Supabase](https://supabase.com) (PostgreSQL, Auth, RLS)
- ESLint + Prettier

## Getting Started

### Install dependencies

```bash
npm install
```

### Start the development server

```bash
npm start
```

Then press `i` for iOS simulator, `a` for Android emulator, `w` for web, or scan the
QR code with the Expo Go app on a physical device.

Other run scripts:

```bash
npm run ios
npm run android
npm run web
```

### Environment variables

Copy `.env.example` to `.env` and fill in values as needed:

```bash
cp .env.example .env
```

Variables are public, client-side config (Expo bundles anything prefixed
`EXPO_PUBLIC_`). Without them, the app still runs — the Supabase client logs a
dev warning and any Supabase call will fail until real values are set. Never
put a service-role key in this file or anywhere in the mobile app.

### Database

The schema lives in `supabase/migrations/`. It has been verified structurally
and for RLS enforcement against an offline embedded Postgres instance (see
Task 002's report), but has **not** been applied to a real local (Docker) or
remote Supabase project yet — that requires either Docker Desktop or an
actual Supabase project's credentials, neither of which is available in this
environment. To apply it once you have one:

```bash
npx supabase start        # local, requires Docker Desktop running
npx supabase db reset     # applies all migrations to the local db

# or, against a remote project:
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

`src/types/database.ts` is hand-authored to match the migration; regenerate
it with `npx supabase gen types typescript --local` (or `--project-id`) once
a database is reachable.

### Linting & formatting

```bash
npm run lint          # ESLint
npm run format:check  # Prettier check
npm run format        # Prettier write
npm run typecheck     # TypeScript, no emit
```

## Project Structure

```
app/                    # Expo Router routes (screens & navigation)
├── (auth)/              # Welcome, Sign In, Sign Up placeholders
└── (tabs)/               # Home, Life, Add, Finance, Reminders placeholders

src/
├── features/            # Feature modules (empty placeholders for future phases)
├── components/          # Shared UI: Button, Card, Screen, LoadingState,
│                         # EmptyState, ErrorState, ErrorBoundary
├── lib/
│   ├── supabase/        # client.ts (Supabase client) + config.ts (env vars)
│   ├── storage/         # Reserved for future local storage
│   └── notifications/   # Reserved for future push notifications
├── hooks/                # Reserved for shared hooks
├── types/                # database.ts (generated-style Supabase types)
├── utils/                # Reserved for shared utilities
└── constants/            # Colors, spacing

supabase/
├── config.toml           # Supabase CLI project config
└── migrations/           # SQL schema migrations (source of truth for the DB)
```

## Status

No authentication UI, dashboard, or feature UI is implemented yet. Routes are
placeholder screens establishing the navigation shape for future work. The
database schema, RLS policies, and Supabase client exist but nothing in the
app calls them yet.
