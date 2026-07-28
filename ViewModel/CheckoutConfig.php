<?php

/**
 * Hyvä Themes - https://hyva.io
 * Copyright © Hyvä Themes 2022-present. All rights reserved.
 * This product is licensed per Magento install
 * See https://hyva.io/license
 */

declare(strict_types=1);

namespace Two\GatewayHyva\ViewModel;

use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Framework\View\Asset\Repository as AssetRepository;
use Two\Gateway\Api\BrandRegistryInterface;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Service\UrlCookie;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use Two\Gateway\Service\Api\Adapter;
use Two\Gateway\Model\Two;

class CheckoutConfig implements ArgumentInterface
{
    /**
     * Placeholder the Alpine component substitutes the buyer's company name
     * into. Deliberately a local constant rather than a reference to the
     * parent module's Two\Gateway\Model\Ui\ConfigProvider: the token never
     * crosses the module boundary at runtime (this view model produces it and
     * this module's own JS consumes it), and referencing the parent's
     * constant would fatal on a parent release that predates it, defeating
     * the method_exists() degradation in getOrderIntentApprovedNotice().
     */
    public const COMPANY_NAME_TOKEN = "{{companyName}}";

    /**
     * @var ConfigRepository
     */
    private $configRepository;

    /**
     * @var BrandRegistryInterface
     */
    private $brandRegistry;

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
     * @var CheckoutSession
     */
    private $checkoutSession;

    /**
     * @var BrandedHyvaViewModelInterface
     */
    private $brandedViewModel;

    public function __construct(
        ConfigRepository $configRepository,
        BrandRegistryInterface $brandRegistry,
        Adapter $adapter,
        Two $two,
        AssetRepository $assetRepository,
        CheckoutSession $checkoutSession,
        BrandedHyvaViewModelInterface $brandedViewModel,
    ) {
        $this->configRepository = $configRepository;
        $this->brandRegistry = $brandRegistry;
        $this->adapter = $adapter;
        $this->two = $two;
        $this->assetRepository = $assetRepository;
        $this->checkoutSession = $checkoutSession;
        $this->brandedViewModel = $brandedViewModel;
    }

    /**
     * Buyer-selectable payment terms (in days) configured by merchant.
     * Empty array when surcharge feature is inactive or none configured.
     */
    public function getAvailableBuyerTerms(): array
    {
        return array_values(array_map('intval', $this->configRepository->getAllBuyerTerms()));
    }

    public function getDefaultPaymentTerm(): int
    {
        return (int) $this->configRepository->getDefaultPaymentTerm();
    }

    /**
     * Currently selected term in checkout session, falling back to default.
     */
    public function getSelectedPaymentTerm(): int
    {
        $sessionTerm = (int) $this->checkoutSession->getTwoSelectedTerm();
        return $sessionTerm > 0 ? $sessionTerm : $this->getDefaultPaymentTerm();
    }

    public function getSurchargeDescription(): string
    {
        return (string) $this->configRepository->getSurchargeLineDescription();
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

    /**
     * Brand-supplied checkout subtitle, rendered under the payment title.
     *
     * The string is brand data (BrandRegistryInterface::getCheckoutSubtitle,
     * from brand.xml). The vanilla Two brand returns '' → no subtitle. Only
     * a non-empty key is passed to the translator, so an unmapped locale
     * falls back to the brand-owned source key rather than leaking a
     * vanilla key. May contain HTML (e.g. a link) — render unescaped.
     */
    public function getCheckoutSubtitleHtml(): string
    {
        $key = $this->brandRegistry->getCheckoutSubtitle();
        return $key === '' ? '' : (string)__($key);
    }

    /**
     * Buyer-facing "order intent approved" notice, or null when the active
     * brand has switched it off.
     *
     * Null means the template must emit no element at all — not an empty
     * wrapper. Otherwise both resolved copy variants are returned plus the
     * token the Alpine component substitutes the buyer's company name into
     * (the company name is only ever known client-side):
     *
     *   withCompany    — company known; the normal case, since an order
     *                    intent is only placed once the buyer's company
     *                    name and number are both resolved
     *   withoutCompany — defensive fallback
     *
     * On/off and wording are two independent brand declarations, resolved by
     * the parent module (TWO-25218 — they used to be conflated in one key,
     * where an empty string meant "off"; do not reintroduce that):
     *
     *   isIntentApprovedNoticeEnabled() — the switch. Explicit boolean in
     *       brand.xml; absent means the documented default true. false here
     *       is the ONLY thing that returns null from this method.
     *   getIntentApprovedNotice()       — copy override only. null (absent,
     *       empty or whitespace-only) means the platform default copy. An
     *       empty override is inert; it no longer switches the notice off.
     *
     * Mirrors Two\Gateway\Model\Ui\ConfigProvider on the Luma side; the
     * brand.xml contract lives on Two\Gateway\Model\Brand\Descriptor.
     *
     * @return array{withCompany:string,withoutCompany:string,companyNameToken:string}|null
     */
    public function getOrderIntentApprovedNotice(): ?array
    {
        // Degrade gracefully on an older parent. composer.json requires
        // two-inc/magento2 ^2.0, which cannot express "the patch release that
        // added these registry methods" — and tightening the constraint would
        // block installs on parents that are otherwise perfectly compatible.
        // A missing method therefore means "no brand opinion": the notice is
        // ON, with the platform default copy, which is correct for every
        // brand that has not opted out. Drop these guards once the parent
        // constraint moves past the release that introduced the methods.
        $enabled = method_exists($this->brandRegistry, "isIntentApprovedNoticeEnabled")
            ? $this->brandRegistry->isIntentApprovedNoticeEnabled()
            : true;

        if (!$enabled) {
            return null;
        }

        $override = method_exists($this->brandRegistry, "getIntentApprovedNotice")
            ? $this->brandRegistry->getIntentApprovedNotice()
            : null;

        $productName = $this->brandRegistry->getProductName();

        // The default is spelled as a literal __() argument so
        // i18n:collect-phrases and the overlay repos' i18n audit can still see
        // it; the override branch takes a variable by necessity.
        // '' should never reach here (the parent normalises blank overrides to
        // null) but is treated as "no override" rather than as an off switch,
        // so a stale parent cannot resurrect empty-means-off.
        $withCompany = ($override === null || $override === "")
            ? __(
                "Your invoice with %1 is likely to be accepted for %2, subject to additional checks.",
                $productName,
                self::COMPANY_NAME_TOKEN,
            )
            : __($override, $productName, self::COMPANY_NAME_TOKEN);

        return [
            "withCompany" => (string) $withCompany,
            "withoutCompany" => (string) __(
                "Your invoice with %1 is likely to be accepted, subject to additional checks.",
                $productName,
            ),
            "companyNameToken" => self::COMPANY_NAME_TOKEN,
        ];
    }

    public function getOrderIntentDeclinedMessage()
    {
        $orderIntentDeclinedMessage = __(
            "Your invoice purchase with %1 has been declined.",
            $this->brandRegistry->getProductName(),
        );
        return $orderIntentDeclinedMessage;
    }

    public function getGeneralErrorMessage()
    {
        $tryAgainLater = __("Please try again later.");
        $generalErrorMessage = __(
            "Something went wrong with your request to %1. %2",
            $this->brandRegistry->getProductName(),
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

    public function getpaymentTermsMessage()
    {
        $paymentTermsLink =
            $this->configRepository->getCheckoutPageUrl() . "/terms";
        return $this->brandedViewModel->getPaymentTermsMessage(
            $paymentTermsLink,
            $this->brandRegistry->getProviderFullName(),
        );
    }

    public function getTermsNotAcceptedMessage()
    {
        $paymentTerms = __(
            "%1 terms and conditions",
            $this->brandRegistry->getProvider(),
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
            $this->brandRegistry->getProductName(),
            $soleTraderaccountCouldNotBeVerified,
        );
        return $soleTraderErrorMessage;
    }
}
