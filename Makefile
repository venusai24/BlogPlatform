# Session lifecycle for the ephemeral layer. See infra/README.md.
.DEFAULT_GOAL := help
.PHONY: help up down status

help: ## list the targets
	@echo "Targets:"
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/^([a-z]+):.*## (.*)/  \1\t\2/'
	@echo ""
	@echo "up needs IMAGE_TAG (and WEB_IMAGE_TAG for the default HTTPS edge); see scripts/session/up.sh"

up: ## apply persistent + ephemeral, wait for health, dry-run reconcile (IMAGE_TAG=<sha> WEB_IMAGE_TAG=<sha> make up)
	scripts/session/up.sh

down: ## destroy the ephemeral layer, then check nothing is left
	scripts/session/down.sh

status: ## read-only: what is running, and is it overdue (exit 1 if so)
	scripts/session/status.sh
