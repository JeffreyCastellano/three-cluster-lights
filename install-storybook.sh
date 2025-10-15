#!/bin/bash

# Storybook Installation Script
# This script installs Storybook dependencies using a temporary cache to avoid permission issues

echo "🚀 Installing Storybook dependencies..."
echo ""

# Use temporary cache directory to bypass npm permission issues
npm install --save-dev \
  @storybook/html@8.6.14 \
  @storybook/addon-essentials@8.6.14 \
  @storybook/addon-links@8.6.14 \
  @storybook/addon-docs@8.6.14 \
  @storybook/html-vite@8.6.14 \
  storybook@8.6.14 \
  vite@5 \
  --cache /tmp/npm-cache-temp \
  --legacy-peer-deps

# Install Three.js (required for stories)
npm install three --cache /tmp/npm-cache-temp

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Storybook installed successfully!"
    echo ""
    echo "To start Storybook:"
    echo "  npm run storybook"
    echo ""
    echo "To build for production:"
    echo "  npm run build-storybook"
    echo ""
else
    echo ""
    echo "❌ Installation failed. Please check the error messages above."
    echo ""
    exit 1
fi

