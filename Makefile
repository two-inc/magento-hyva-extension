# ==============================================================================
# Development environment
# ==============================================================================

-include .env.local

CONTAINER  := magento-hyva
IMAGE      := michielgerritsen/magento-project-community-edition
TAG        := php82-fpm-magento2.4.6-sample-data
PORT       := 1236
URL        := http://localhost:$(PORT)/

TWO_ENV              := $(shell gcloud config get-value account 2>/dev/null | grep -q '@two\.inc$$' && echo staging || echo sandbox)
TWO_API_BASE_URL     ?= https://api.$(TWO_ENV).two.inc
TWO_CHECKOUT_BASE_URL ?= https://checkout.$(TWO_ENV).two.inc
TWO_STORE_COUNTRY    ?= NO
HYVA_PACKAGIST_URL   ?= https://hyva-themes.repo.packagist.com
export PORT

.PHONY: help install configure compile run debug stop clean flush logs proxy archive patch minor major format test

.DEFAULT_GOAL := help

## Show this help
help:
	@awk '/^## /{desc=substr($$0,4)} /^[a-zA-Z_-]+:/{if(desc){printf "  \033[36m%-16s\033[0m %s\n",$$1,desc; desc=""}}' $(MAKEFILE_LIST)

## Create Magento container, install plugins and Xdebug
install: clean
	docker run -d \
		--name=$(CONTAINER) \
		-p $(PORT):80 \
		--add-host=host.docker.internal:host-gateway \
		-e URL=$(URL) \
		-e TWO_API_BASE_URL=$(TWO_API_BASE_URL) \
		-e TWO_CHECKOUT_BASE_URL=$(TWO_CHECKOUT_BASE_URL) \
		-v $(CURDIR):/data/extensions/workdir \
		$(IMAGE):$(TAG)
	@echo "Waiting for Magento to start..."
	@until docker exec $(CONTAINER) php bin/magento --version 2>/dev/null; do sleep 3; done
	@if [ -f auth.json ]; then \
		echo "Found auth.json — configuring Hyvä private packagist..."; \
		docker cp auth.json $(CONTAINER):/data/auth.json; \
		docker exec $(CONTAINER) composer config repositories.hyva-themes composer $(HYVA_PACKAGIST_URL); \
	else \
		echo "No auth.json — stubbing Hyvä dependency (checkout UI won't render)"; \
		docker exec $(CONTAINER) php /data/extensions/workdir/dev/stub-hyva; \
	fi
	docker exec $(CONTAINER) composer require two-inc/magento2-hyva-checkout:@dev --no-plugins
	docker exec $(CONTAINER) rm -rf /data/generated/code
	docker exec $(CONTAINER) php bin/magento module:disable Magento_AdminAdobeImsTwoFactorAuth Magento_TwoFactorAuth
	docker exec $(CONTAINER) php bin/magento module:enable Two_Gateway Two_GatewayHyva
	docker exec $(CONTAINER) php bin/magento setup:upgrade
	# di:compile before deploy:mode:set developer — di:compile resets Magento
	# to production mode as a side effect, so setting developer mode first
	# gets silently wiped. Ordering bug originally caught on abn-develop
	# (commit 28a55d8), ported forward here.
	docker exec $(CONTAINER) php bin/magento setup:di:compile
	docker exec $(CONTAINER) php bin/magento deploy:mode:set developer
	$(MAKE) configure TWO_API_KEY=$(or $(TWO_API_KEY),dummy-dev-key) TWO_ENV=$(TWO_ENV)
	docker exec $(CONTAINER) bash /data/extensions/workdir/dev/install-xdebug
	@echo ""
	@echo "========================================="
	@echo " Magento store: $(URL)"
	@echo " Admin panel:   $(URL)admin"
	@echo " Credentials:   exampleuser / examplepassword123"
	@echo " Xdebug:        installed (activate with 'make debug')"
	@echo "========================================="

## Update payment config: make configure TWO_API_KEY=xxx
configure:
	docker exec \
		-e TWO_API_KEY=$(TWO_API_KEY) \
		-e TWO_ENV=$(or $(TWO_ENV),sandbox) \
		-e TWO_STORE_COUNTRY=$(TWO_STORE_COUNTRY) \
		$(CONTAINER) php /data/extensions/workdir/dev/configure
	docker exec $(CONTAINER) php bin/magento cache:flush
	docker restart $(CONTAINER)

## Recompile Magento DI (after adding/changing PHP classes, plugins, or preferences)
compile:
	docker exec $(CONTAINER) php bin/magento setup:di:compile
	docker restart $(CONTAINER)

## Start Magento container and FRP proxy
run:
	docker start $(CONTAINER)
	@./start-proxy.sh --background || true
	@PROXY_URL=$$(./start-proxy.sh url 2>/dev/null); \
	if [ -n "$$PROXY_URL" ]; then \
		docker exec $(CONTAINER) bash /data/extensions/workdir/dev/patch-proxy "$$PROXY_URL" 2>&1 | grep -v Xdebug; \
	fi; \
	echo ""; \
	echo "========================================="; \
	echo " Magento store: $(URL)"; \
	echo " Admin panel:   $(URL)admin"; \
	if [ -n "$$PROXY_URL" ]; then \
		echo " Proxy store:   $$PROXY_URL/"; \
		echo " Proxy admin:   $$PROXY_URL/admin"; \
	fi; \
	echo " Credentials:   exampleuser / examplepassword123"; \
	echo "========================================="

## Start Magento with Xdebug and caches disabled for hot reload
debug:
	docker start $(CONTAINER)
	@docker exec $(CONTAINER) bash -c '\
		INIS=$$(find /etc/php /usr/local/etc/php -name "*xdebug*" 2>/dev/null); \
		if [ -n "$$INIS" ]; then \
			echo "$$INIS" | xargs sed -i "s/xdebug.mode=off/xdebug.mode=debug/"; \
			echo "Xdebug activated (listening on port 9003)"; \
		else \
			echo "Xdebug not installed (run: make install)"; \
		fi'
	docker exec $(CONTAINER) php bin/magento cache:disable
	docker exec $(CONTAINER) php bin/magento cache:flush
	docker restart $(CONTAINER)
	@./start-proxy.sh --background || true
	@PROXY_URL=$$(./start-proxy.sh url 2>/dev/null); \
	if [ -n "$$PROXY_URL" ]; then \
		docker exec $(CONTAINER) bash /data/extensions/workdir/dev/patch-proxy "$$PROXY_URL" 2>&1 | grep -v Xdebug; \
	fi; \
	echo ""; \
	echo "========================================="; \
	echo " Magento store: $(URL)"; \
	echo " Admin panel:   $(URL)admin"; \
	if [ -n "$$PROXY_URL" ]; then \
		echo " Proxy store:   $$PROXY_URL/"; \
		echo " Proxy admin:   $$PROXY_URL/admin"; \
	fi; \
	echo " Credentials:   exampleuser / examplepassword123"; \
	echo " Mode:          debug (Xdebug + caches disabled)"; \
	echo "========================================="

## Stop Magento container and FRP proxy
stop:
	-./start-proxy.sh stop 2>/dev/null
	-docker exec $(CONTAINER) bash /data/extensions/workdir/dev/patch-proxy --reset 2>/dev/null
	docker stop $(CONTAINER)

## Clear static content and flush caches (frontend + adminhtml JS/CSS/templates)
flush:
	docker exec $(CONTAINER) bash -c \
		"rm -rf pub/static/frontend/* var/view_preprocessed/pub/static/frontend/* \
		pub/static/adminhtml/* var/view_preprocessed/pub/static/adminhtml/* \
		&& php bin/magento cache:flush"

## Remove the Magento container and stop proxy
clean:
	-./start-proxy.sh stop 2>/dev/null
	-docker stop $(CONTAINER) 2>/dev/null
	-docker rm $(CONTAINER) 2>/dev/null

## Run FRP proxy in foreground (Ctrl-C to stop)
proxy:
	./start-proxy.sh

## Tail Two plugin logs
logs:
	docker exec $(CONTAINER) bash -c 'mkdir -p var/log/two && touch var/log/two/debug.log var/log/two/error.log && chmod -R 777 var/log/two && tail -f var/log/two/debug.log var/log/two/error.log'

# ==============================================================================
# Release
# ==============================================================================

## Create a versioned zip archive
archive:
	eval $$(bumpver show --environ) && git archive --format zip HEAD > two-gateway-hyva-extension-$${CURRENT_VERSION}.zip
bumpver-%:
	SKIP=commit-msg bumpver update --$*
## Bump patch version
patch: bumpver-patch
## Bump minor version
minor: bumpver-minor
## Bump major version
major: bumpver-major

## Format frontend assets with Prettier
format:
	prettier -w view/frontend/templates/
	prettier -w view/frontend/web/css/

# ==============================================================================
# Tests
# ==============================================================================

# Pinned to match phpunit.xml's schema (10.5) and CI's `tools: phpunit:10.5`
# pin (.github/workflows/ci.yml) — keep these three in lockstep.
PHPUNIT_VERSION := 10.5.64
PHPUNIT_SHA256  := a823d916151f628dd9943ccc81a98bcfbba9c5babf53f27be6c7dccc89f8ee23

## Run PHPUnit tests (self-contained stub bootstrap, no Magento required)
test:
	docker run --rm -v $(CURDIR):/app -w /app php:8.1-cli bash -c \
		"php -r \"copy('https://phar.phpunit.de/phpunit-$(PHPUNIT_VERSION).phar', '/tmp/phpunit.phar');\" \
		&& echo '$(PHPUNIT_SHA256)  /tmp/phpunit.phar' | sha256sum -c - \
		&& php /tmp/phpunit.phar"
