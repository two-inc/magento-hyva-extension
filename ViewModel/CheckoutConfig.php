<?php

/**
 * Hyvä Themes - https://hyva.io
 * Copyright © Hyvä Themes 2022-present. All rights reserved.
 * This product is licensed per Magento install
 * See https://hyva.io/license
 */

declare(strict_types=1);

namespace Two\GatewayHyva\ViewModel;

use Magento\Framework\Locale\ResolverInterface as LocaleResolver;
use Magento\Framework\View\Asset\Repository as AssetRepository;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use Magento\Store\Model\StoreManagerInterface;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Model\Two;
use Two\Gateway\Model\Ui\ConfigProvider as UpstreamConfigProvider;
use Two\Gateway\Service\Api\Adapter;
use Two\Gateway\Service\UrlCookie;

class CheckoutConfig implements ArgumentInterface
{
    private ConfigRepository $configRepository;
    private Two $two;
    private Adapter $adapter;
    private AssetRepository $assetRepository;
    private UpstreamConfigProvider $upstreamConfig;
    private StoreManagerInterface $storeManager;
    private LocaleResolver $localeResolver;

    /**
     * Cached upstream payment.two_payment config slice.
     * @var array<string, mixed>|null
     */
    private ?array $twoPaymentConfig = null;

    public function __construct(
        ConfigRepository $configRepository,
        Adapter $adapter,
        Two $two,
        AssetRepository $assetRepository,
        UpstreamConfigProvider $upstreamConfig,
        StoreManagerInterface $storeManager,
        LocaleResolver $localeResolver,
    ) {
        $this->configRepository = $configRepository;
        $this->adapter = $adapter;
        $this->two = $two;
        $this->assetRepository = $assetRepository;
        $this->upstreamConfig = $upstreamConfig;
        $this->storeManager = $storeManager;
        $this->localeResolver = $localeResolver;
    }

    /**
     * Read a single key from the upstream `payment.two_payment` config slice.
     * Cached after first access. Falls back to default if the key is missing.
     */
    private function upstream(string $key, mixed $default = null): mixed
    {
        if ($this->twoPaymentConfig === null) {
            $cfg = $this->upstreamConfig->getConfig();
            $this->twoPaymentConfig = $cfg['payment']['two_payment'] ?? [];
        }
        return $this->twoPaymentConfig[$key] ?? $default;
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
            $merchant = $this->adapter->execute(
                "/v1/merchant/verify_api_key",
                [],
                "GET",
            );
        }
        $orderIntentConfig = [
            "extensionPlatformName" => $this->configRepository->getExtensionPlatformName(),
            "extensionDBVersion" => $this->configRepository->getExtensionDBVersion(),
            "weightUnit" => $this->configRepository->getWeightUnit(),
            "merchant" => $merchant,
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
        $countries = ["no", "gb", "se", "nl"];
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
            "Buy now, receive your goods, pay your invoice later.",
        );
        return $redirectMessage;
    }

    public function getOrderIntentApprovedMessage()
    {
        $orderIntentApprovedMessage = __(
            "Your invoice purchase with %1 is likely to be accepted subject to additional checks.",
            $this->configRepository::PRODUCT_NAME,
        );
        return $orderIntentApprovedMessage;
    }

    public function getOrderIntentDeclinedMessage()
    {
        $orderIntentDeclinedMessage = __(
            "Your invoice purchase with %1 has been declined.",
            $this->configRepository::PRODUCT_NAME,
        );
        return $orderIntentDeclinedMessage;
    }

    public function getGeneralErrorMessage()
    {
        $tryAgainLater = __("Please try again later.");
        $generalErrorMessage = __(
            "Something went wrong with your request to %1. %2",
            $this->configRepository::PRODUCT_NAME,
            $tryAgainLater,
        );
        return $generalErrorMessage;
    }

    public function getInvalidEmailListMessage()
    {
        $invalidEmailListMessage = __(
            "Please ensure that your invoice email address list only contains valid email addresses separated by commas.",
        );
        return $invalidEmailListMessage;
    }

    /**
     * T&Cs message rendered next to the consent checkbox.
     *
     * Delegates to the upstream `Two\Gateway\Model\Ui\ConfigProvider` so the
     * copy stays aligned with the main plugin (no longer duplicated here).
     * The returned string contains an anchor tag — render raw, do not escape.
     */
    public function getpaymentTermsMessage(): string
    {
        return (string)$this->upstream('paymentTermsMessage', '');
    }

    /**
     * Net-terms options the buyer can pick from on checkout.
     *
     * @return array<int, array{days: int, label: string}>
     */
    public function getAvailableBuyerTerms(): array
    {
        return (array)$this->upstream('availableBuyerTerms', []);
    }

    /**
     * Map of `{days: fee}` precomputed at page load.
     *
     * @return array<int|string, float|int|string>
     */
    public function getTermSurcharges(): array
    {
        return (array)$this->upstream('termSurcharges', []);
    }

    /**
     * Merchant-configured default term in days.
     */
    public function getDefaultPaymentTerm(): ?int
    {
        $value = $this->upstream('defaultPaymentTerm');
        return $value === null ? null : (int)$value;
    }

    /**
     * Buyer's currently selected term, if any. Persisted via the `select-term`
     * webapi → `$checkoutSession->getTwoSelectedTerm()`.
     */
    public function getSelectedPaymentTerm(): ?int
    {
        $value = $this->upstream('selectedPaymentTerm');
        return $value === null ? null : (int)$value;
    }

    /**
     * Active store currency (e.g. EUR, GBP, NOK). Used by Intl.NumberFormat.
     */
    public function getCurrencyCode(): string
    {
        return (string)$this->storeManager->getStore()->getCurrentCurrencyCode();
    }

    /**
     * BCP-47 locale tag (e.g. en-GB) for Intl.NumberFormat. Magento returns
     * locales with underscores (`en_GB`); normalise to hyphens. Strips
     * codeset suffixes (`en_GB.UTF-8` → `en-GB`) and falls back to en-US
     * when the resolver yields nothing usable, so the JS-side
     * Intl.NumberFormat doesn't throw and produce a non-localised fallback.
     */
    public function getLocaleCode(): string
    {
        $locale = (string)$this->localeResolver->getLocale();
        // Strip codeset / modifier suffixes: en_GB.UTF-8 → en_GB, en_GB@latin → en_GB
        $locale = preg_replace('/[.@].*$/', '', $locale);
        $locale = str_replace('_', '-', $locale);
        return $locale !== '' ? $locale : 'en-US';
    }

    public function getTermsNotAcceptedMessage()
    {
        $paymentTerms = __(
            "%1 terms and conditions",
            $this->configRepository::PROVIDER,
        );
        $termsNotAcceptedMessage = __(
            "You must accept %1 to place order.",
            $paymentTerms,
        );
        return $termsNotAcceptedMessage;
    }

    public function getSoleTraderErrorMessage()
    {
        $soleTraderaccountCouldNotBeVerified = __(
            "Your sole trader account could not be verified.",
        );
        $soleTraderErrorMessage = __(
            "Something went wrong with your request to %1. %2",
            $this->configRepository::PRODUCT_NAME,
            $soleTraderaccountCouldNotBeVerified,
        );
        return $soleTraderErrorMessage;
    }
}
