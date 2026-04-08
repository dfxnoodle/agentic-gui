#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_ROOT_DEFAULT="/var/www"

DEPLOY_ROOT="$DEPLOY_ROOT_DEFAULT"
RELEASE_NAME="agentic-gui-$(date -u +%Y%m%dT%H%M%SZ)"
INCLUDE_ENV=1
INSTALL_DEPS=1

usage() {
  cat <<'EOF'
Usage: bash scripts/deploy-production.sh [options]

Builds the monorepo and creates a production release bundle under /var/www.

Options:
  --include-env           Copy the root .env into the release bundle (default).
  --install               Run npm ci before building. This is the default.
  --skip-install          Skip npm ci and use the current workspace install as-is.
  --output-dir PATH       Override the deploy output root (default: /var/www).
  --release-name NAME     Override the generated release directory name.
  -h, --help              Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-env)
      INCLUDE_ENV=1
      shift
      ;;
    --install)
      INSTALL_DEPS=1
      shift
      ;;
    --skip-install)
      INSTALL_DEPS=0
      shift
      ;;
    --output-dir)
      DEPLOY_ROOT="$2"
      shift 2
      ;;
    --release-name)
      RELEASE_NAME="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

copy_file() {
  local source_path="$1"
  local target_path="$2"
  mkdir -p "$(dirname "$target_path")"
  cp "$source_path" "$target_path"
}

copy_directory() {
  local source_path="$1"
  local target_path="$2"
  mkdir -p "$(dirname "$target_path")"
  cp -R "$source_path" "$target_path"
}

require_command npm
require_command tar

get_env_value() {
  local key="$1"
  local fallback="$2"
  local value

  value="$(grep -E "^${key}=" "$ROOT_DIR/.env" | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"

  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return
  fi

  printf '%s' "$fallback"
}

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "Missing $ROOT_DIR/.env. Create it before producing a deployment bundle." >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.env.example" ]]; then
  echo "Missing $ROOT_DIR/.env.example." >&2
  exit 1
fi

BACKEND_PORT="$(get_env_value PORT 3001)"

DEPLOY_ROOT="$(cd "$ROOT_DIR" && mkdir -p "$DEPLOY_ROOT" && cd "$DEPLOY_ROOT" && pwd)"
RELEASES_DIR="$DEPLOY_ROOT/releases"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"
ARCHIVE_PATH="$DEPLOY_ROOT/$RELEASE_NAME.tar.gz"

rm -rf "$RELEASE_DIR"
rm -f "$ARCHIVE_PATH"
mkdir -p "$RELEASE_DIR"

pushd "$ROOT_DIR" >/dev/null

if [[ "$INSTALL_DEPS" -eq 1 ]]; then
  npm ci
fi

npm run build

copy_file "$ROOT_DIR/package.json" "$RELEASE_DIR/package.json"
copy_file "$ROOT_DIR/package-lock.json" "$RELEASE_DIR/package-lock.json"
copy_file "$ROOT_DIR/.env.example" "$RELEASE_DIR/.env.example"

if [[ "$INCLUDE_ENV" -eq 1 ]]; then
  copy_file "$ROOT_DIR/.env" "$RELEASE_DIR/.env"
fi

copy_file "$ROOT_DIR/packages/backend/package.json" "$RELEASE_DIR/packages/backend/package.json"
copy_file "$ROOT_DIR/packages/shared/package.json" "$RELEASE_DIR/packages/shared/package.json"
copy_file "$ROOT_DIR/packages/frontend/package.json" "$RELEASE_DIR/packages/frontend/package.json"

copy_directory "$ROOT_DIR/packages/backend/dist" "$RELEASE_DIR/packages/backend/dist"
copy_directory "$ROOT_DIR/packages/shared/dist" "$RELEASE_DIR/packages/shared/dist"
copy_directory "$ROOT_DIR/packages/frontend/dist" "$RELEASE_DIR/packages/frontend/dist"

cat > "$RELEASE_DIR/DEPLOY.md" <<'EOF'
# Agentic GUI Production Deployment

This release bundle contains:

- Node.js backend build output in packages/backend/dist
- Shared package build output in packages/shared/dist
- Static frontend build output in packages/frontend/dist

## Requirements

- Node.js 20+
- npm 10+
- A reverse proxy or static file server for packages/frontend/dist

## Backend startup

1. Copy .env.example to .env if .env is not already present.
2. Fill in at least PORT, FRONTEND_PORT, JWT_SECRET, AGENTIC_GUI_SECRET_KEY, ADMIN_USERNAME, and ADMIN_PASSWORD.
3. Run npm ci --omit=dev.
4. Start the API with npm run start --workspace=packages/backend.

## Frontend hosting

Serve packages/frontend/dist as static files and route SPA requests back to index.html.
Proxy /api and /api/events to the backend port from .env.

See nginx.agentic-gui.conf.example for a sample Nginx configuration.
EOF

printf '\nThe current bundle was generated with PORT=%s.\n' "$BACKEND_PORT" >> "$RELEASE_DIR/DEPLOY.md"

cat > "$RELEASE_DIR/nginx.agentic-gui.conf.example" <<EOF
server {
    listen 80;
    server_name _;

    root /var/www/agentic-gui/;
    index index.html;

    location /api/ {
      proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /api/events {
      proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600;
        add_header Cache-Control no-cache;
    }

    location / {
      try_files \$uri \$uri/ /index.html;
    }
}
EOF

tar -czf "$ARCHIVE_PATH" -C "$RELEASES_DIR" "$RELEASE_NAME"

popd >/dev/null

echo "Created production release directory: $RELEASE_DIR"
echo "Created production archive: $ARCHIVE_PATH"
if [[ "$INCLUDE_ENV" -eq 0 ]]; then
  echo "The release bundle does not include .env. Copy it separately on the target host."
fi