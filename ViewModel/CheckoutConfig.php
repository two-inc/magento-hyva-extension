<?php
/**
 * Hyvä Themes - https://hyva.io
 * Copyright © Hyvä Themes 2022-present. All rights reserved.
 * This product is licensed per Magento install
 * See https://hyva.io/license
 */

declare(strict_types=1);

namespace Two\GatewayHyva\ViewModel;

use Magento\Framework\View\Asset\Repository as AssetRepository;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Service\UrlCookie;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use Two\Gateway\Service\Api\Adapter;
use Two\Gateway\Model\Two;

class CheckoutConfig implements ArgumentInterface
{
    /**
     * @var ConfigRepository
     */
    private $configRepository;

    /**
     * @var Two
     */
    private $two;

    /**
     * @var Adapter
     */
    private $adapter;

    /**
     * @var AssetRepository
     */
    private $assetRepository;

    /**
     * CheckoutConfig constructor.
     *
     * @param ConfigRepository $configRepository
     * @param Adapter $adapter
     * @param Two $two
     * @param AssetRepository $assetRepository
     */

    public function __construct(
        ConfigRepository $configRepository,
        Adapter $adapter,
        Two $two,
        AssetRepository $assetRepository
    ) {
        $this->configRepository = $configRepository;
        $this->adapter = $adapter;
        $this->two = $two;
        $this->assetRepository = $assetRepository;
    }

    public function getCheckoutApiUrl()
    {
        return $this->configRepository->getCheckoutApiUrl();
    }

    public function getCheckoutPageUrl()
    {
        return $this->configRepository->getCheckoutPageUrl();
    }
    public function getRedirectUrlCookieCode()
    {
        return UrlCookie::COOKIE_NAME;
    }

    public function getIsOrderIntentEnabled()
    {
        return $this->configRepository->isOrderIntentEnabled();
    }

    public function getIsInvoiceEmailsEnabled()
    {
        return $this->configRepository->isInvoiceEmailsEnabled();
    }

    public function getOrderIntentConfig()
    {
        $merchant = null;
        if ($this->configRepository->getApiKey()) {
            $merchant = $this->adapter->execute('/v1/merchant/verify_api_key', [], 'GET');
        }
        $orderIntentConfig = [
            'extensionPlatformName' => $this->configRepository->getExtensionPlatformName(),
            'extensionDBVersion' => $this->configRepository->getExtensionDBVersion(),
            'weightUnit' => $this->configRepository->getWeightUnit(),
            'merchant' => $merchant,
        ];
        return $orderIntentConfig;
    }
    public function getIsCompanySearchEnabled()
    {
        return $this->configRepository->isCompanySearchEnabled();
    }

    public function getIsAddressSearchEnabled()
    {
        return $this->configRepository->isAddressSearchEnabled();
    }

    public function getCompanySearchLimit()
    {
        return 50;
    }

    public function getSupportedCountryCodes()
    {
        $countries = ['no', 'gb', 'se', 'nl'];
        return $countries;
    }

    public function getIsDepartmentFieldEnabled()
    {
        return $this->configRepository->isDepartmentEnabled();
    }

    public function getIsProjectFieldEnabled()
    {
        return $this->configRepository->isProjectEnabled();
    }

    public function getIsOrderNoteFieldEnabled()
    {
        return $this->configRepository->isOrderNoteEnabled();
    }

    public function getIsPONumberFieldEnabled()
    {
        return $this->configRepository->isPONumberEnabled();
    }

    public function getIsPaymentTermsEnabled()
    {
        return true;
    }

    public function getRedirectMessage()
    {
        $redirectMessage = __(
                        'Pay within 30 days of delivery. There are no additional costs for you.'
                    );
        return $redirectMessage;
    }

    public function getOrderIntentApprovedMessage()
    {
        $orderIntentApprovedMessage = __(
            'Your invoice purchase with %1 is likely to be accepted subject to additional checks.',
            $this->configRepository::PRODUCT_NAME
        );
        return $orderIntentApprovedMessage;
    }

    public function getOrderIntentDeclinedMessage()
    {
        $orderIntentDeclinedMessage = __(
            'Your invoice purchase with %1 has been declined.',
            $this->configRepository::PRODUCT_NAME
        );
        return $orderIntentDeclinedMessage;
    }

    public function getGeneralErrorMessage()
    {
        $tryAgainLater = __('Please try again later.');
        $generalErrorMessage = __(
            'Something went wrong with your request to %1. %2',
            $this->configRepository::PRODUCT_NAME,
            $tryAgainLater
        );
        return $generalErrorMessage;
    }

    public function getInvalidEmailListMessage()
    {
        $invalidEmailListMessage = __('Please ensure that your invoice email address list only contains valid email addresses separated by commas.');
        return $invalidEmailListMessage;
    }

    public function getpaymentTermsMessage()
    {
        $paymentTerms = __("terms and conditions of %1", $this->configRepository::PRODUCT_NAME);
        $paymentTermsLink = $this->configRepository->getCheckoutPageUrl() . '/terms';
        $paymentTermsEmail = $this->configRepository::PAYMENT_TERMS_EMAIL;
        $paymentTermsMessage = __(
            'I have filled in all the details truthfully and accept to pay the invoice in 30 days. '.
            'I agree to the %1. ' .
            'You hereby give permission to %2 to decide on the basis ' .
            'of automated processing of (personal) data whether you can use %3. ' .
            'You can withdraw this permission by sending an e-mail to %4.',
            sprintf('<a class="text-blue-600" href="%s" target="_blank">%s</a>', $paymentTermsLink, $paymentTerms),
            $this->configRepository::PROVIDER_FULL_NAME,
            $this->configRepository::PRODUCT_NAME,
            sprintf('<a class="text-blue-600" href="mailto:%s">%s</a>', $paymentTermsEmail, $paymentTermsEmail)
        );
        return $paymentTermsMessage;
    }

    public function getTermsNotAcceptedMessage()
    {
        $paymentTerms = __("terms and conditions of %1", $this->configRepository::PRODUCT_NAME);
        $termsNotAcceptedMessage = __('You must accept %1 to place order.', $paymentTerms);
        return $termsNotAcceptedMessage;
                    
    }

    public function getSoleTraderErrorMessage()
    {
        $soleTraderaccountCouldNotBeVerified = __('Your sole trader account could not be verified.');
        $soleTraderErrorMessage = __(
            'Something went wrong with your request to %1. %2',
            $this->configRepository::PRODUCT_NAME,
            $soleTraderaccountCouldNotBeVerified
        );
        return $soleTraderErrorMessage;
    }
}
