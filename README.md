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

## Deployment on Render

### Backend Deployment

1. Create new Web Service on Render
2. Connect GitHub repository: `https://github.com/Eskndrani/DataStore.git`
3. Set Build Command: `cd milestone\ 3/backend && npm install`
4. Set Start Command: `cd milestone\ 3/backend && npm start`
5. Add Environment Variables:
   - `DB_HOST` - Your Aiven MySQL host
   - `DB_PORT` - 17687 (or your port)
   - `DB_USER` - Your DB username
   - `DB_PASSWORD` - Your DB password
   - `DB_NAME` - datagov_db
   - `CORS_ORIGIN` - Your frontend URL on Render

### Frontend Deployment

1. Create new Static Site on Render
2. Connect GitHub repository
3. Build Command: `cd milestone\ 3/frontend && npm install && npm run build`
4. Publish Directory: `milestone\ 3/frontend/dist`
5. Add Environment Variable:
   - `VITE_API_URL` - Your backend URL on Render

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
- **Deployment**: Render
- **Tools**: Git, npm, nodemon

## License

Educational Project for CSCE 2501
