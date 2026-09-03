.PHONY: build serve agent-deps plan apply

build:
	node scripts/build-site.mjs

serve: build
	python3 -m http.server 8000 --directory site/

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

plan: agent-deps
	terraform -chdir=terraform plan -out=tfplan

apply:
	terraform -chdir=terraform apply tfplan
