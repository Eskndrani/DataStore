# Milestone 3 Application Layer

This folder contains the full web application for the Data.gov database project.

## Structure

```text
milestone 3/
  backend/
    package.json
    .env.example
    server.js
  frontend/
    package.json
    .env.example
    index.html
    vite.config.js
    src/
      App.js
      main.jsx
      index.css
      components/
        Dashboard.jsx
```

## Run Commands

### 1. Backend
```bash
cd "milestone 3/backend"
npm install
copy .env.example .env
npm run dev
```

### 2. Frontend
```bash
cd "milestone 3/frontend"
npm install
copy .env.example .env
npm run dev
```

## Notes

- Set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `backend/.env` to your remote MySQL server.
- Set `VITE_API_BASE_URL` in `frontend/.env` to the Express API URL.
- The backend auto-detects whether your database uses the legacy `project` tables or the newer `dataset_usage` table.
