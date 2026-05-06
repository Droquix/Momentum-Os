# Momentum OS

Production MVP foundation for a web-first productivity system built with `Next.js` and `Supabase`.

## What is implemented

- App Router project structure for a real rebuild
- Phase 1 product shell focused on `capture + task engine`
- Supabase schema migration for the core relational model
- Server-ready AI/provider abstraction and capture parsing routes
- Responsive dashboard UI for inbox, tasks, projects, goals, notes, and focus
- Google Calendar and advanced planning reserved behind explicit interfaces

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env.local` and fill in the values.
3. Run the app:

```bash
npm run dev
```

4. Apply the database schema using your normal Supabase migration workflow.

## Current implementation note

This workspace environment did not expose a usable `npm` executable, so the codebase was scaffolded manually and not executed here. The structure is ready to install and run in a normal Node/npm environment.
