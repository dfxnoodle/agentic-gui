#!/usr/bin/env bash
set -euo pipefail

# Find the node executable to ensure npm commands work correctly
NODE_BIN_DIR="$(dirname $(which node))"
export PATH="$PATH:$NODE_BIN_DIR"

echo "========================================="
echo "🚀 Updating Live Application"
echo "========================================="

echo "1. Pulling latest code from Git..."
git pull || { echo "Git pull failed. Proceeding with current code anyway."; }

# Generate a unique release name based on the current timestamp
RELEASE_NAME="agentic-gui-$(date -u +%Y%m%dT%H%M%SZ)"
echo "   New release name: $RELEASE_NAME"

echo -e "\n2. Building the production bundle..."
bash scripts/deploy-production.sh --output-dir deploy-dist --release-name "$RELEASE_NAME"

RELEASE_DIR="$(pwd)/deploy-dist/releases/$RELEASE_NAME"
if [[ ! -d "$RELEASE_DIR" ]]; then
    echo "Error: Release directory $RELEASE_DIR not found!"
    exit 1
fi

echo -e "\n3. Installing production dependencies for the new release..."
pushd "$RELEASE_DIR" >/dev/null
npm ci --omit=dev
popd >/dev/null

TARGET_DIR="/var/www/agentic-gui/$RELEASE_NAME"

echo -e "\n4. Deploying to $TARGET_DIR..."
sudo cp -r "$RELEASE_DIR" "$TARGET_DIR"

echo -e "\n5. Setting strict permissions (www-data)..."
sudo chown -R www-data:www-data "$TARGET_DIR"

echo -e "\n6. Updating the live symlink for zero-downtime..."
sudo ln -sfn "$TARGET_DIR" /var/www/agentic-gui/current

echo -e "\n7. Restarting the backend service..."
sudo systemctl restart agentic-gui-backend.service

echo "========================================="
echo "✅ Deployment complete! Live site updated to $RELEASE_NAME"
echo "========================================="
