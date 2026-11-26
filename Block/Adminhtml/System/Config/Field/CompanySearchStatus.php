<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Block\Adminhtml\System\Config\Field;

use Magento\Backend\Block\Template\Context;
use Magento\Config\Block\System\Config\Form\Field;
use Magento\Framework\Data\Form\Element\AbstractElement;
use Magento\Framework\Exception\NoSuchEntityException;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Service\Merchant\ApiKeyStatus;

/**
 * Why the Hyva company-search control is absent from checkout (ABN-518).
 *
 * Reads the same API-key verdict as the base module (its ApiKeyStatus
 * service). The base module's admin health checklist reports company search
 * too, but no tagged base release carries that row yet. Retire this row, with
 * its template, test and translations, once a tagged base release carries the
 * base company-search row (see docs/release-and-versioning.md).
 */
class CompanySearchStatus extends Field
{
    /**
     * @var string
     */
    protected $_template = 'Two_GatewayHyva::system/config/field/company-search-status.phtml';

    /**
     * @var ApiKeyStatus
     */
    protected $apiKeyStatus;

    /**
     * @var ConfigRepository
     */
    protected $configRepository;

    public function __construct(
        ApiKeyStatus $apiKeyStatus,
        ConfigRepository $configRepository,
        Context $context,
        array $data = []
    ) {
        $this->apiKeyStatus = $apiKeyStatus;
        $this->configRepository = $configRepository;
        parent::__construct($context, $data);
    }

    /**
     * @return array{state: string, value: string}
     */
    public function getStatusRow(): array
    {
        $storeId = $this->resolveScopeStoreId();
        $notShown = (string) __('Not shown at checkout');
        // A disabled method stands the control down wherever it sits, so it is
        // named before the verdict (TWO-27227), as the base module's row does.
        // The separator is the one the reasons below use.
        if (!$this->configRepository->isActive($storeId)) {
            return [
                'state' => 'withheld',
                'value' => $notShown . " \u{2014} "
                    . (string) __('the payment method is disabled. Check Enable payment method.'),
            ];
        }
        // The verdict first (TWO-27224): a missing or rejected key withholds the
        // control wherever it sits, because with the setting below off it moves
        // into the payment tile, which the base module withholds on this same
        // verdict.
        switch ($this->apiKeyStatus->getStatus($storeId)['status']) {
            case ApiKeyStatus::NOT_CONFIGURED:
                return [
                    'state' => 'withheld',
                    'value' => $notShown . ' — ' . (string) __('no API key is saved. Check API key.'),
                ];
            case ApiKeyStatus::INVALID_KEY:
                return [
                    'state' => 'withheld',
                    'value' => $notShown . ' — '
                        . (string) __('the API key was rejected. Check API key and Environment.'),
                ];
        }

        // ABN-533: every other verdict falls through to the cached record, so
        // the control is offered and the setting only decides where. In the
        // payment tile it shows only when the base module offers the method,
        // which this module does not re-derive; the value says so.
        if (!$this->configRepository->isCompanySearchEnabled($storeId)) {
            return [
                'state' => 'ok',
                'value' => (string) __(
                    'Shown in the payment method when it is offered (Enable company search in address entry is No)'
                ),
            ];
        }

        return ['state' => 'ok', 'value' => (string) __('Shown at checkout')];
    }

    /**
     * The scope the config page is open at, so the row reports the same
     * store's verdict the checkout gate would. A stale scope param degrades to
     * the default scope rather than taking the page down.
     */
    protected function resolveScopeStoreId(): ?int
    {
        try {
            $store = (string) $this->getRequest()->getParam('store');
            if ($store !== '') {
                return (int) $this->_storeManager->getStore($store)->getId();
            }
            $website = (string) $this->getRequest()->getParam('website');
            if ($website !== '') {
                $default = $this->_storeManager->getWebsite($website)->getDefaultStore();
                return $default ? (int) $default->getId() : null;
            }
        } catch (NoSuchEntityException) {
            return null;
        }

        return null;
    }

    /**
     * @param array{state: string, value: string} $row
     */
    public function getStatusColour(array $row): string
    {
        return $row['state'] === 'ok' ? '#079633' : '#e02b27';
    }

    /**
     * @inheritDoc
     */
    public function render(AbstractElement $element)
    {
        $element->unsScope()->unsCanUseWebsiteValue()->unsCanUseDefaultValue();
        return parent::render($element);
    }

    /**
     * @inheritDoc
     */
    public function _getElementHtml(AbstractElement $element)
    {
        return $this->_toHtml();
    }
}
