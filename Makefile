tag:
	eval $$(bumpver show --environ) && git tag abn-$${CURRENT_VERSION} -f && git push origin abn-$${CURRENT_VERSION} -f && git push origin abn-main-csp -f
archive:
	eval $$(bumpver show --environ) && mkdir -p artifacts/$${CURRENT_VERSION} && git archive --format zip HEAD > artifacts/$${CURRENT_VERSION}/magento-abn-hyva-extension.zip
publish: archive
	gsutil cp -r artifacts/* gs://achteraf-betalen/magento/ && ./scripts/publish-to-bucket.py
format:
	prettier -w view/frontend/templates/
	prettier -w view/frontend/web/css/
