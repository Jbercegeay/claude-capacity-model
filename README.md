# Claude Capacity Model

Excel-free capacity planning app for manufacturing teams. The project rebuilds a workbook-based capacity model as a database-backed web application with a SQLite source of truth, an Express API, and a Vite frontend.

## What It Does

- Imports and normalizes operating assumptions from the legacy Excel model.
- Stores capacity, schedule, employee, oven, yield, item-standard, and forecast data in SQLite.
- Accepts Oracle forecast uploads and runs demand/capacity calculations against database inputs.
- Provides operational and admin views for reviewing utilization, gaps, standards, forecast changes, and master data.
- Keeps reporting modes explicit, including official, review, and combined coverage scenarios.

## Why This Project Matters

The original planning workflow depended on a complex spreadsheet. This rebuild moves the model into maintainable application code, making calculations easier to audit, data easier to update, and the planning workflow easier to extend.

## Tech Stack

- Node.js and Express
- SQLite
- Vite
- Vanilla JavaScript modules
- SheetJS for Excel/Oracle forecast ingestion
- PM2-compatible process config

## Project Structure

- `server.js`: Express API, upload handling, SQLite reads/writes, and calculation endpoints.
- `db/`: schema, initialization, migration, and SQLite compatibility helpers.
- `src/data/`: API client and database-backed calculation engine.
- `src/views/`: operational, demand breakdown, report guide, login, and admin screens.
- `src/components/`: shared UI components.
- `index.html`: Vite entry point.
- `ecosystem.config.cjs`: PM2 process configuration.

## Getting Started

Install dependencies:

```bash
npm install
```

Initialize the local database:

```bash
npm run db:init
```

If migrating from the legacy Excel workbook, run:

```bash
npm run db:migrate
```

Start the API server:

```bash
npm start
```

Run the Vite frontend during development:

```bash
npm run dev
```

The Express server defaults to port `3381`.

## Available Scripts

- `npm run dev`: start the Vite development server.
- `npm run build`: build the frontend.
- `npm start`: start the Express server.
- `npm run db:init`: create the SQLite database from the schema.
- `npm run db:migrate`: migrate source workbook data into SQLite.
- `npm run db:refresh`: refresh migrated data.

## Notes

This repository does not include production forecast files or private operating data. Local database files and imported source data should stay out of version control.
