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

APP_ROOT="/var/www/agentic-gui"
SHARED_DIR="$APP_ROOT/shared"
PERSISTENT_DATA_DIR="$SHARED_DIR/data"
CURRENT_LINK="$APP_ROOT/current"
CURRENT_DATA_DIR="$CURRENT_LINK/packages/backend/data"

echo -e "\n3. Installing production dependencies for the new release..."
pushd "$RELEASE_DIR" >/dev/null
npm ci --omit=dev
popd >/dev/null

TARGET_DIR="/var/www/agentic-gui/$RELEASE_NAME"

echo -e "\n4. Deploying to $TARGET_DIR..."
sudo cp -r "$RELEASE_DIR" "$TARGET_DIR"

echo -e "\n5. Preparing persistent backend data directory..."
sudo mkdir -p "$PERSISTENT_DATA_DIR"

# One-time migration path: move existing data from the currently live release.
if sudo test -d "$CURRENT_DATA_DIR" && ! sudo test -f "$PERSISTENT_DATA_DIR/.migrated-from-release"; then
    if [[ -z "$(sudo ls -A "$PERSISTENT_DATA_DIR")" ]]; then
        echo "   Migrating existing backend data from current release..."
        sudo cp -a "$CURRENT_DATA_DIR/." "$PERSISTENT_DATA_DIR/"
    fi
    sudo touch "$PERSISTENT_DATA_DIR/.migrated-from-release"
fi

echo "   Forcing DATA_DIR to persistent storage..."
if sudo grep -qE '^DATA_DIR=' "$TARGET_DIR/.env"; then
    sudo sed -i "s|^DATA_DIR=.*$|DATA_DIR=$PERSISTENT_DATA_DIR|" "$TARGET_DIR/.env"
else
    echo "DATA_DIR=$PERSISTENT_DATA_DIR" | sudo tee -a "$TARGET_DIR/.env" >/dev/null
fi

# Keep compatibility with default path-based storage by linking package data dir.
sudo rm -rf "$TARGET_DIR/packages/backend/data"
sudo ln -sfn "$PERSISTENT_DATA_DIR" "$TARGET_DIR/packages/backend/data"

echo -e "\n6. Setting strict permissions (www-data)..."
sudo chown -R www-data:www-data "$TARGET_DIR"
sudo chown -R www-data:www-data "$SHARED_DIR"

echo -e "\n7. Updating the live symlink for zero-downtime..."
sudo ln -sfn "$TARGET_DIR" /var/www/agentic-gui/current

echo -e "\n8. Restarting the backend service..."
sudo systemctl restart agentic-gui-backend.service

echo "========================================="
echo "✅ Deployment complete! Live site updated to $RELEASE_NAME"
echo "========================================="
