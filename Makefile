## --- Variables ---
# Retrieve the first non-loopback local IP address for LAN access
IP := $(shell hostname -I | awk '{print $$1}')
# Use a dedicated port for dev testing to avoid conflicts with 'serve'
DEV_PORT := 8001
SITE_DIR := site

.PHONY: build serve dev mock agent-deps site-deps vendor plan apply

## --- Build & Local Development ---
build:
	node scripts/build-site.mjs

serve: build
	python3 -m http.server 8000 --directory site/

# Serve the site on the local network with QR code for quick mobile testing
dev: build
	@echo "Serving on http://$(IP):$(DEV_PORT)..."
	@qrencode -t ansiutf8 "http://$(IP):$(DEV_PORT)"
	python3 -m http.server $(DEV_PORT) --bind 0.0.0.0 --directory $(SITE_DIR)

# Serve the real site/ with a fake /api/chat that replays
# pre-recorded NDJSON fixtures from mocks/replies/ in rotation, one per
# request, instead of a live agent backend.
mock: build
	@echo "Mock site: http://localhost:8002/"
	python3 mocks/server.py

# 'marked' and 'dompurify' are declared as npm dependencies so Trivy can scan
# them for CVEs, but the site loads them as plain <script> tags with no bundler.
# This stamp follows the same pattern as agent/node_modules/.deps-stamp below.
node_modules/.deps-stamp: package.json package-lock.json
	npm ci
	sha256sum package-lock.json | cut -d' ' -f1 > $@

site-deps:
	@[ "$$(cat node_modules/.deps-stamp 2>/dev/null)" = "$$(sha256sum package-lock.json | cut -d' ' -f1)" ] \
		|| rm -f node_modules/.deps-stamp
	@$(MAKE) --no-print-directory node_modules/.deps-stamp

# Copy the browser builds of 'marked' and 'dompurify' into site/js/vendor
vendor: site-deps
	npm run vendor

# AWS Lambda's nodejs22.x runtime lacks 'zod' and '@strands-agents/sdk', and AWS
# won't install them at deploy time. We must package 'node_modules' inside the zip.
# The .deps-stamp file saves the lockfile hash so 'make' and Terraform can detect
# if 'node_modules' is missing or outdated before building the archive.
agent/node_modules/.deps-stamp: agent/package.json agent/package-lock.json
	npm ci --omit=dev --prefix agent
	sha256sum agent/package-lock.json | cut -d' ' -f1 > $@

# Check actual file content, not just timestamps (mtime).
# If the stamp hash does not match package-lock.json, delete the stamp
# to force 'make' to re-run 'npm ci' and rebuild the dependencies cleanly.
agent-deps:
	@[ "$$(cat agent/node_modules/.deps-stamp 2>/dev/null)" = "$$(sha256sum agent/package-lock.json | cut -d' ' -f1)" ] \
		|| rm -f agent/node_modules/.deps-stamp
	@$(MAKE) --no-print-directory agent/node_modules/.deps-stamp

## --- Infrastructure & Deployment ---
plan: agent-deps
	terraform -chdir=terraform plan -out=tfplan

apply:
	terraform -chdir=terraform apply tfplan
