.PHONY: build serve

build:
	node scripts/build-site.mjs

serve: build
	python3 -m http.server 8000 --directory site/
