# DataStore Full-Stack Application

A professional data exploration and analytics platform built with React, Express.js, and MySQL.

## Features

- **Analytics Dashboard**: Real-time statistics and visualizations
- **Dataset Explorer**: Filter and search datasets with fuzzy matching
- **User Portal**: Registration and data submission
- **RESTful API**: Complete backend API for data operations
- **Professional UI**: Dark enterprise theme with responsive design

## Architecture

- **Frontend**: React 18 + Vite on Port 5173
- **Backend**: Express.js with MySQL2 on Port 5000  
- **Database**: Aiven MySQL (remote)
- **CORS**: Configured for cross-origin requests

## Development Setup

### Prerequisites
- Node.js 16+
- npm or yarn
- MySQL database (local or remote)

### Backend Setup

```bash
cd milestone\ 3/backend
npm install
npm run dev
```

Create `.env` file:
```
PORT=5000
DB_HOST=your-db-host
DB_PORT=3306
DB_USER=your-username
DB_PASSWORD=your-password
DB_NAME=datagov_db
CORS_ORIGIN=http://localhost:5173
```

### Frontend Setup

```bash
cd milestone\ 3/frontend
npm install
npm run dev
```

Create `.env` file:
```
VITE_API_URL=http://localhost:5000
```

## API Endpoints

### Statistics
- `GET /api/stats/top-organizations` - Top 5 organizations
- `GET /api/stats/contributions` - Contributions by type
- `GET /api/stats/top-datasets` - Top datasets
- `GET /api/stats/usage-by-project-type` - Usage aggregations
- `GET /api/stats/top-tags-by-project-type` - Tag frequency

### Dataset Filtering
- `GET /api/datasets/by-organization-type/:orgType` - Filter by org
- `GET /api/datasets/by-tag/:tagName` - Filter by tag
- `GET /api/datasets/by-format/:format` - Filter by format

### User Management
- `POST /api/auth/register` - Register new user
- `POST /api/usage` - Submit usage data
- `GET /api/usage/:email` - Get user history

### Metadata
- `GET /api/meta` - Schema information

## Deployment on Railway

### Backend Deployment

1. Create a new Railway project and link this repository.
2. Add a new service and set Root Directory to `milestone 3/backend`.
3. Leave Railway builder as Nixpacks (default).
4. Start Command: `npm start`.
5. Add the backend environment variables in Railway dashboard:
   - `PORT`
   - `DB_HOST`
   - `DB_PORT`
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_NAME`
   - `CORS_ORIGIN`

### Frontend Deployment

1. Add a second Railway service for the frontend.
2. Set Root Directory to `milestone 3/frontend`.
3. Build Command: `npm install && npm run build`.
4. Start Command (if using static serve): `npx serve -s dist -l $PORT`.
5. Add frontend env var:
   - `VITE_API_URL` (set to your backend Railway URL)

## File Structure

```
├── milestone\ 3/
│   ├── backend/
│   │   ├── server.js          # Express server
│   │   ├── package.json       # Backend dependencies
│   │   └── .env               # Backend config
│   └── frontend/
│       ├── src/
│       │   ├── components/Dashboard.jsx
│       │   ├── App.jsx
│       │   ├── main.jsx
│       │   └── index.css
│       ├── package.json      # Frontend dependencies
│       ├── vite.config.js    # Vite config
│       └── .env              # Frontend config
└── build.sh                  # Build script
```

## Technologies Used

- **Frontend**: React, Vite, CSS3
- **Backend**: Express.js, Node.js
- **Database**: MySQL, Aiven Cloud
- **Deployment**: Railway
- **Tools**: Git, npm, nodemon

## License

Educational Project for CSCE 2501
