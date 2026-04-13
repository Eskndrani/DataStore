#!/usr/bin/env sh
# Build script for backend service
set -e

echo "Installing backend dependencies..."
npm install
echo "Backend build complete."
