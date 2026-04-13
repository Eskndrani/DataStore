#!/usr/bin/env sh
# Build script for Render deployment
set -e

echo "Building backend..."
cd milestone\ 3/backend
npm install

echo "Building frontend..."
cd ../frontend
npm install
npm run build

echo "Build complete!"
