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
use Two\GatewayHyva\Service\ApiKeyVerificationStatus;

/**
 * Why the Hyva company-search control is absent from checkout (ABN-518).
 *
 * This extension withholds the control on its OWN API-key verdict, which is a
 * separate read from the base module's, so the base module's health panel
 * cannot answer for it.
 */
class CompanySearchStatus extends Field
{
    /**
     * @var string
     */
    protected $_template = 'Two_GatewayHyva::system/config/field/company-search-status.phtml';

    /**
     * @var ApiKeyVerificationStatus
     */
    protected $apiKeyStatus;

    /**
     * @var ConfigRepository
     */
    protected $configRepository;

    public function __construct(
        ApiKeyVerificationStatus $apiKeyStatus,
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
        // The address-step control is gated on this setting as well as on the
        // verdict; with it off the control moves into the payment tile.
        if (!$this->configRepository->isCompanySearchEnabled($storeId)) {
            return [
                'state' => 'ok',
                'value' => (string) __('Shown in the payment method — Enable company search in address entry is No.'),
            ];
        }
        switch ($this->apiKeyStatus->getStatus($storeId)) {
            case ApiKeyVerificationStatus::OK:
                return ['state' => 'ok', 'value' => (string) __('Shown at checkout')];
            case ApiKeyVerificationStatus::NOT_CONFIGURED:
                return [
                    'state' => 'withheld',
                    'value' => $notShown . ' — ' . (string) __('no API key is saved. Check API key.'),
                ];
            case ApiKeyVerificationStatus::INVALID_KEY:
                return [
                    'state' => 'withheld',
                    'value' => $notShown . ' — '
                        . (string) __('the API key was rejected. Check API key and Environment.'),
                ];
        }

        // ABN-533: every other verdict falls through to the cached record.
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
