.PHONY: build serve agent-deps plan apply

build:
	node scripts/build-site.mjs

serve: build
	python3 -m http.server 8000 --directory site/

# The Lambda package ships node_modules: the nodejs22.x runtime provides neither
# @strands-agents/sdk nor zod, and nothing installs them at deploy time. The
# stamp records which lockfile the installed tree came from, so both make and
# the Terraform precondition can tell a stale tree from a current one.
agent/node_modules/.deps-stamp: agent/package.json agent/package-lock.json
	npm ci --omit=dev --prefix agent
	sha256sum agent/package-lock.json | cut -d' ' -f1 > $@

agent-deps: agent/node_modules/.deps-stamp

plan: agent-deps
	terraform -chdir=terraform plan -out=tfplan

apply:
	terraform -chdir=terraform apply tfplan
