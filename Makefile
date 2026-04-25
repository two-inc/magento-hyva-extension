# ==============================================================================
# Development environment
# ==============================================================================

# Brand overlay (optional). MUST be included before any `?=` defaults below so
# brand-side `:=` assignments win. Leave alone on `main`. See AGENTS.md → Brand
# overlay. Present only on brand branches such as `abn-main`.
-include Makefile.brand
ifneq (,$(wildcard Makefile.brand))
$(info Loaded Makefile.brand — brand overlay active)
endif

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
TWO_BRAND            ?=
TWO_BRAND_VERSION    ?=
HYVA_PACKAGIST_URL   ?= https://hyva-themes.repo.packagist.com
LOG_DIR              ?= var/log/two
BRAND                ?= two
export PORT

.PHONY: help install configure compile run debug stop clean flush logs proxy archive patch minor major format test

.DEFAULT_GOAL := help

## Show this help
help:
	@echo "Brand: $(BRAND)"
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
		$(if $(TWO_BRAND),-e TWO_BRAND=$(TWO_BRAND)) \
		$(if $(TWO_BRAND_VERSION),-e TWO_BRAND_VERSION=$(TWO_BRAND_VERSION)) \
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
	docker exec $(CONTAINER) composer require --no-plugins \
		community-engineering/language-nl_nl \
		community-engineering/language-nb_no \
		community-engineering/language-sv_se \
		community-engineering/language-fi_fi \
		community-engineering/language-da_dk
	docker exec $(CONTAINER) rm -rf /data/generated/code
	docker exec $(CONTAINER) php bin/magento module:disable Magento_AdminAdobeImsTwoFactorAuth Magento_TwoFactorAuth
	docker exec $(CONTAINER) php bin/magento module:enable Two_Gateway Two_GatewayHyva
	docker exec $(CONTAINER) php bin/magento setup:upgrade
	docker exec $(CONTAINER) php bin/magento deploy:mode:set developer
	docker exec $(CONTAINER) php bin/magento setup:di:compile
	$(MAKE) configure TWO_API_KEY=$(or $(TWO_API_KEY),dummy-dev-key) TWO_ENV=$(TWO_ENV)
	docker exec $(CONTAINER) bash /data/extensions/workdir/dev/install-xdebug
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
	echo " Xdebug:        installed (activate with 'make debug')"; \
	echo "========================================="

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
		"rm -rf pub/static/frontend/* pub/static/adminhtml/* \
			var/view_preprocessed/pub/static/frontend/* \
			var/view_preprocessed/pub/static/adminhtml/* \
		&& php bin/magento cache:flush \
		&& (apachectl graceful 2>/dev/null || true)"

## Remove the Magento container and stop proxy
clean:
	-./start-proxy.sh stop 2>/dev/null
	-docker stop $(CONTAINER) 2>/dev/null
	-docker rm $(CONTAINER) 2>/dev/null

## Run FRP proxy in foreground (Ctrl-C to stop)
proxy:
	./start-proxy.sh

## Tail plugin logs
logs:
	docker exec $(CONTAINER) bash -c 'mkdir -p $(LOG_DIR) && touch $(LOG_DIR)/debug.log $(LOG_DIR)/error.log && chmod -R 777 $(LOG_DIR) && tail -f $(LOG_DIR)/debug.log $(LOG_DIR)/error.log'

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

PHPUNIT_VERSION := 9.6.34
PHPUNIT_SHA256  := e7264ae61fe58a487c2bd741905b85940d8fbc2b32cf4a279949b6d9a172a06a

## Run PHPUnit tests
test:
	docker run --rm -v $(CURDIR):/app -w /app php:8.1-cli bash -c \
		"php -r \"copy('https://phar.phpunit.de/phpunit-$(PHPUNIT_VERSION).phar', '/tmp/phpunit.phar');\" \
		&& echo '$(PHPUNIT_SHA256)  /tmp/phpunit.phar' | sha256sum -c - \
		&& php /tmp/phpunit.phar"
