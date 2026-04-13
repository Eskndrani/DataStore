#!/usr/bin/env sh
# Build script for local or CI usage
set -e

echo "Building backend..."
cd milestone\ 3/backend
npm install

echo "Building frontend..."
cd ../frontend
npm install
npm run build

echo "Build complete!"
