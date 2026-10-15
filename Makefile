# Makefile — thin wrapper around the npm scripts, for people who prefer make.
#
#   make            list targets
#   make run        dev build with hot reload (tauri dev)
#   make release    optimised binary
#   make bundle     .deb + .rpm + .AppImage
#   make install    build and install for the current user
#   make test       rust + frontend tests
#   make demo       single-file HTML demo
#   make lint       cargo fmt check + clippy

SHELL := /bin/bash
NPM   := npm

.PHONY: help deps run release bundle install uninstall test test-rust test-js lint fmt icon demo serve clean

help:
	@sed -n '2,12p' Makefile

deps:
	$(NPM) install --no-audit --no-fund

run: deps
	$(NPM) run dev

release: deps
	$(NPM) run build

bundle: deps
	$(NPM) run bundle
	@echo "artifacts:"
	@find src-tauri/target/release/bundle -maxdepth 3 -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \)

install:
	./scripts/install.sh

uninstall:
	./scripts/install.sh --uninstall

test: test-rust test-js

test-rust:
	cargo test --manifest-path src-tauri/Cargo.toml

test-js: deps
	$(NPM) test

lint:
	cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

fmt:
	cargo fmt --manifest-path src-tauri/Cargo.toml

icon:
	python3 scripts/make-icons.py --preview

demo: deps
	$(NPM) run demo

serve:
	$(NPM) run serve

clean:
	cargo clean --manifest-path src-tauri/Cargo.toml
	rm -rf demo/ dist/
