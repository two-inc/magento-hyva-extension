archive:
	eval $$(bumpver show --environ) && git archive --format zip HEAD > two-gateway-hyva-extension-$${CURRENT_VERSION}.zip
bumpver-%:
	SKIP=commit-msg bumpver update --$*
patch: bumpver-patch
minor: bumpver-minor
major: bumpver-major
format:
	prettier -w view/frontend/templates/
	prettier -w view/frontend/web/css/
