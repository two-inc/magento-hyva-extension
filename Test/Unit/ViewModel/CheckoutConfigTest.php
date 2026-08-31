<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\ViewModel;

use PHPUnit\Framework\TestCase;
use ReflectionClass;
use Two\GatewayHyva\ViewModel\CheckoutConfig;

/**
 * getOrderIntentApprovedNotice() is the Hyvä consumer of two independent brand
 * declarations (TWO-25218): a boolean switch and a copy override. The switch is
 * the only thing that suppresses the notice; an empty override is inert.
 *
 * The view model is built with newInstanceWithoutConstructor() and the brand
 * registry injected by reflection: every other constructor dependency is a
 * Magento framework class this method never touches, and stubbing them would
 * buy nothing but a bigger fixture. Fake registries are anonymous classes, not
 * mocks of the parent interface, precisely so one of them can OMIT a method and
 * stand in for an older parent release.
 */
class CheckoutConfigTest extends TestCase
{
    // TWO-25326 §7.3 (2026-08-03 ruling): the default copy embeds both the
    // name and number tokens directly, replacing the standalone tile label.
    private const DEFAULT_WITH_COMPANY =
        'This order by {{companyName}} ({{companyNumber}}) is likely to be accepted by TestProduct';

    private const DEFAULT_WITHOUT_COMPANY =
        'Your invoice with TestProduct is likely to be accepted, subject to additional checks.';

    private const DEFAULT_NOT_AVAILABLE_WITH_COMPANY =
        'TestProduct is not available for this order by {{companyName}} ({{companyNumber}})';

    public function testSwitchEnabledReturnsDefaultCopy(): void
    {
        $notice = $this->noticeFor($this->registry(true, null));

        $this->assertNotNull($notice);
        $this->assertSame(self::DEFAULT_WITH_COMPANY, $notice['withCompany']);
        $this->assertSame(self::DEFAULT_WITHOUT_COMPANY, $notice['withoutCompany']);
        $this->assertSame(CheckoutConfig::COMPANY_NAME_TOKEN, $notice['companyNameToken']);
        $this->assertSame(CheckoutConfig::COMPANY_NUMBER_TOKEN, $notice['companyNumberToken']);
    }

    /**
     * false ⇒ null ⇒ the template emits no element at all, rather than an
     * empty, permanently hidden wrapper.
     */
    public function testSwitchDisabledReturnsNull(): void
    {
        $this->assertNull($this->noticeFor($this->registry(false, null)));
    }

    /**
     * A copy override present alongside a false switch must still be
     * suppressed — the switch decides, the override only words it.
     */
    public function testSwitchDisabledWinsOverCopyOverride(): void
    {
        $this->assertNull($this->noticeFor($this->registry(false, 'Overridden for %1 and %2.')));
    }

    /**
     * Older parent lacking the switch method: no brand opinion ⇒ notice ON.
     * This degradation is load-bearing while composer requires only ^2.0.
     */
    public function testOlderParentWithoutSwitchMethodKeepsNoticeOn(): void
    {
        $registry = new class () {
            public function getProductName(): string
            {
                return 'TestProduct';
            }
        };

        $notice = $this->noticeFor($registry);

        $this->assertNotNull($notice);
        $this->assertSame(self::DEFAULT_WITH_COMPANY, $notice['withCompany']);
    }

    public function testCopyOverridePassesThroughWithPlaceholders(): void
    {
        $notice = $this->noticeFor($this->registry(true, 'Approved: %1 for %2.'));

        $this->assertNotNull($notice);
        $this->assertSame('Approved: TestProduct for {{companyName}}.', $notice['withCompany']);
        // An override replaces the company-known variant only.
        $this->assertSame(self::DEFAULT_WITHOUT_COMPANY, $notice['withoutCompany']);
    }

    /**
     * The parent normalises blank overrides to null, but an empty string must
     * never resurrect the old empty-means-off behaviour.
     */
    public function testEmptyCopyOverrideIsInert(): void
    {
        $notice = $this->noticeFor($this->registry(true, ''));

        $this->assertNotNull($notice);
        $this->assertSame(self::DEFAULT_WITH_COMPANY, $notice['withCompany']);
    }

    /**
     * TWO-25326 §7.3: the "not available" notice shares the approved
     * notice's on/off switch — no independent gate exists for it.
     */
    public function testNotAvailableNoticeFollowsTheSameSwitch(): void
    {
        $notice = $this->notAvailableFor($this->registry(true, null));

        $this->assertNotNull($notice);
        $this->assertSame(self::DEFAULT_NOT_AVAILABLE_WITH_COMPANY, $notice['withCompany']);
        $this->assertSame(CheckoutConfig::COMPANY_NAME_TOKEN, $notice['companyNameToken']);
        $this->assertSame(CheckoutConfig::COMPANY_NUMBER_TOKEN, $notice['companyNumberToken']);

        $this->assertNull($this->notAvailableFor($this->registry(false, null)));
    }

    /**
     * TWO-25326 §7.1: Hyvä has no setting of its own — the location is the
     * negation of the CORE module's `enable_company_search` setting, read
     * through the same injected ConfigRepository as
     * getIsCompanySearchEnabled()/getIsAddressSearchEnabled() below. Enabled
     * (true, address-area) must yield false here; disabled (false, tile) must
     * yield true.
     */
    public function testIsCompanySearchInPaymentTileIsTheNegationOfTheCoreSetting(): void
    {
        $this->assertFalse($this->isInPaymentTileFor(true));
        $this->assertTrue($this->isInPaymentTileFor(false));
    }

    private function isInPaymentTileFor(bool $coreEnableCompanySearch): bool
    {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();

        $configRepository = new class ($coreEnableCompanySearch) {
            /** @var bool */
            private $enabled;

            public function __construct(bool $enabled)
            {
                $this->enabled = $enabled;
            }

            public function isCompanySearchEnabled(): bool
            {
                return $this->enabled;
            }
        };

        $reflection->getProperty('configRepository')->setValue($viewModel, $configRepository);

        return $viewModel->getIsCompanySearchInPaymentTile();
    }

    /**
     * @return array{withCompany:string,withoutCompany:string,companyNameToken:string,companyNumberToken:string}|null
     */
    private function notAvailableFor(object $brandRegistry): ?array
    {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();
        $reflection->getProperty('brandRegistry')->setValue($viewModel, $brandRegistry);

        return $viewModel->getOrderIntentNotAvailableNotice();
    }

    private function registry(bool $enabled, ?string $override): object
    {
        return new class ($enabled, $override) {
            /** @var bool */
            private $enabled;

            /** @var string|null */
            private $override;

            public function __construct(bool $enabled, ?string $override)
            {
                $this->enabled = $enabled;
                $this->override = $override;
            }

            public function isIntentApprovedNoticeEnabled(): bool
            {
                return $this->enabled;
            }

            public function getIntentApprovedNotice(): ?string
            {
                return $this->override;
            }

            public function getProductName(): string
            {
                return 'TestProduct';
            }
        };
    }

    /**
     * The company-search threshold, TWO-25288.
     *
     * One constant for the repo, reached through one getter. The templates read
     * it for BOTH the guard that enforces it and the hint that claims it, so
     * this is the single point where the two can be kept from drifting apart.
     *
     * Asserted as an int rather than loosely: it is emitted into the Alpine
     * components as a bare numeric literal for a numeric length comparison, and
     * a string would compare lexically there.
     */
    public function testCompanySearchMinCharsIsTheSharedConstant(): void
    {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();

        $this->assertSame(3, CheckoutConfig::COMPANY_SEARCH_MIN_CHARS);
        $this->assertSame(
            CheckoutConfig::COMPANY_SEARCH_MIN_CHARS,
            $viewModel->getCompanySearchMinChars()
        );
    }

    /**
     * @return array{withCompany:string,withoutCompany:string,companyNameToken:string}|null
     */
    private function noticeFor(object $brandRegistry): ?array
    {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();

        // No setAccessible() call: it has been a no-op since PHP 8.1 and is
        // deprecated in 8.5, which CI would surface as a deprecation notice.
        $reflection->getProperty('brandRegistry')->setValue($viewModel, $brandRegistry);

        return $viewModel->getOrderIntentApprovedNotice();
    }

    /**
     * TWO-25326 (WooCommerce-plugin port, PR #445): company search must be
     * off when EITHER the merchant's `enable_company_search` setting is off
     * OR the API key can't currently be verified — neither alone is
     * sufficient to turn it on.
     */
    public function testCompanySearchEnabledRequiresBothTheCoreSettingAndAVerifiedKey(): void
    {
        $this->assertTrue($this->isCompanySearchEnabledFor(true, true));
        $this->assertFalse($this->isCompanySearchEnabledFor(true, false));
        $this->assertFalse($this->isCompanySearchEnabledFor(false, true));
        $this->assertFalse($this->isCompanySearchEnabledFor(false, false));
    }

    /**
     * TWO-25326, 2026-08-06 ruling: address AUTOFILL requires BOTH the
     * `enable_address_search` setting AND the one company-search control
     * living in the address entry.
     *
     * The reported bug is the second term missing: with company search in the
     * payment tile, picking a company there filled in the buyer's address
     * anyway — writing city / postcode / street several steps behind where the
     * buyer was looking, over an address they had already completed.
     *
     * Asserted as the full truth table, because the failure mode is one term
     * being dropped and either term alone reproduces the bug in one direction.
     */
    public function testAddressAutofillNeedsBothTheSettingAndTheAddressAreaControl(): void
    {
        // (enable_address_search, enable_company_search) — the second is what
        // decides WHERE the control renders: true = address area.
        $this->assertTrue($this->isAddressSearchEnabledFor(true, true));
        $this->assertFalse($this->isAddressSearchEnabledFor(true, false));
        $this->assertFalse($this->isAddressSearchEnabledFor(false, true));
        $this->assertFalse($this->isAddressSearchEnabledFor(false, false));
    }

    private function isAddressSearchEnabledFor(
        bool $coreEnableAddressSearch,
        bool $coreEnableCompanySearch
    ): bool {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();

        $configRepository = new class ($coreEnableAddressSearch, $coreEnableCompanySearch) {
            /** @var bool */
            private $addressSearch;

            /** @var bool */
            private $companySearch;

            public function __construct(bool $addressSearch, bool $companySearch)
            {
                $this->addressSearch = $addressSearch;
                $this->companySearch = $companySearch;
            }

            public function isAddressSearchEnabled(): bool
            {
                return $this->addressSearch;
            }

            public function isCompanySearchEnabled(): bool
            {
                return $this->companySearch;
            }
        };

        $reflection->getProperty('configRepository')->setValue($viewModel, $configRepository);

        return (bool) $viewModel->getIsAddressSearchEnabled();
    }

    public function testGetIsApiKeyVerifiedDelegatesToTheInjectedStatusService(): void
    {
        $this->assertTrue($this->isApiKeyVerifiedFor(true));
        $this->assertFalse($this->isApiKeyVerifiedFor(false));
    }

    private function isCompanySearchEnabledFor(bool $coreEnableCompanySearch, bool $apiKeyVerified): bool
    {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();

        $configRepository = new class ($coreEnableCompanySearch) {
            /** @var bool */
            private $enabled;

            public function __construct(bool $enabled)
            {
                $this->enabled = $enabled;
            }

            public function isCompanySearchEnabled(): bool
            {
                return $this->enabled;
            }
        };

        $reflection->getProperty('configRepository')->setValue($viewModel, $configRepository);
        $reflection->getProperty('apiKeyVerificationStatus')->setValue(
            $viewModel,
            $this->apiKeyVerificationStatusFake($apiKeyVerified)
        );

        return $viewModel->getIsCompanySearchEnabled();
    }

    private function isApiKeyVerifiedFor(bool $verified): bool
    {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();

        $reflection->getProperty('apiKeyVerificationStatus')->setValue(
            $viewModel,
            $this->apiKeyVerificationStatusFake($verified)
        );

        return $viewModel->getIsApiKeyVerified();
    }

    private function apiKeyVerificationStatusFake(bool $verified): object
    {
        return new class ($verified) {
            /** @var bool */
            private $verified;

            public function __construct(bool $verified)
            {
                $this->verified = $verified;
            }

            public function isVerified(): bool
            {
                return $this->verified;
            }
        };
    }
}
