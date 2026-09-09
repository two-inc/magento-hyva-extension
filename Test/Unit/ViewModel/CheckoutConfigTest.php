<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\ViewModel;

use PHPUnit\Framework\TestCase;
use ReflectionClass;
use Two\Gateway\Model\Ui\CheckoutTileCopy;
use Two\GatewayHyva\ViewModel\CheckoutConfig;

/**
 * getOrderIntentApprovedNotice() is the Hyvä consumer of two independent brand
 * declarations (TWO-25218): a boolean switch and a copy override. The switch is
 * the only thing that suppresses the notice; an empty override is inert.
 *
 * The view model is built with newInstanceWithoutConstructor() and only the
 * collaborator under test injected by reflection: every other constructor
 * dependency is a framework class these methods never touch.
 */
class CheckoutConfigTest extends TestCase
{
    // TWO-25326: the default copy embeds both the
    // name and number tokens directly, replacing the standalone tile label.
    private const DEFAULT_WITH_COMPANY =
        'This order by {{companyName}} ({{companyNumber}}) is likely to be accepted by TestProduct';

    private const DEFAULT_WITHOUT_COMPANY =
        'Your invoice with TestProduct is likely to be accepted, subject to additional checks.';

    private const DEFAULT_NOT_AVAILABLE_WITH_COMPANY =
        'TestProduct is not available for this order by {{companyName}} ({{companyNumber}})';

    // No trailing period — the catalogues are keyed on the base provider's literal.
    private const DEFAULT_NOT_AVAILABLE_WITHOUT_COMPANY =
        'TestProduct is not available for this order';

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
     * @dataProvider notAvailableNoticeCases
     */
    public function testNotAvailableNoticeReadsTheDeclinedDeclarations(
        object $brandRegistry,
        ?string $expectedWithCompany,
        string $case
    ): void {
        $notice = $this->notAvailableFor($brandRegistry);

        if ($expectedWithCompany === null) {
            $this->assertNull($notice, $case);
            return;
        }

        $this->assertNotNull($notice, $case);
        $this->assertSame($expectedWithCompany, $notice['withCompany'], $case);
        $this->assertSame(
            self::DEFAULT_NOT_AVAILABLE_WITHOUT_COMPANY,
            $notice['withoutCompany'],
            $case . ': an override words the company-known variant only'
        );
        $this->assertSame(CheckoutConfig::COMPANY_NAME_TOKEN, $notice['companyNameToken'], $case);
        $this->assertSame(CheckoutConfig::COMPANY_NUMBER_TOKEN, $notice['companyNumberToken'], $case);
    }

    /**
     * @return array<int, array{0:object, 1:?string, 2:string}>
     */
    public static function notAvailableNoticeCases(): array
    {
        return [
            [
                self::declinedRegistry(true, null, true),
                self::DEFAULT_NOT_AVAILABLE_WITH_COMPANY,
                'switch on, no override: platform default copy',
            ],
            [
                self::declinedRegistry(false, null, true),
                null,
                'switch off: suppressed even with the approved notice on',
            ],
            [
                self::declinedRegistry(false, 'Declined: %1 cannot serve %2 (%3).', true),
                null,
                'switch off with an override: the switch decides',
            ],
            [
                self::declinedRegistry(true, 'Declined: %1 cannot serve %2 (%3).', true),
                'Declined: TestProduct cannot serve {{companyName}} ({{companyNumber}}).',
                'override replaces the copy, placeholders filled',
            ],
            [
                self::declinedRegistry(true, '', true),
                self::DEFAULT_NOT_AVAILABLE_WITH_COMPANY,
                'empty override is inert, not an off switch',
            ],
            [
                self::declinedRegistry(true, null, false),
                self::DEFAULT_NOT_AVAILABLE_WITH_COMPANY,
                'approved notice off does not suppress this one',
            ],
            [
                self::legacyRegistry(true),
                self::DEFAULT_NOT_AVAILABLE_WITH_COMPANY,
                'base without the declined pair: approved switch on',
            ],
            [
                self::legacyRegistry(false),
                null,
                'base without the declined pair: approved switch off still gates',
            ],
            [
                new class {
                    public function getProductName(): string
                    {
                        return 'TestProduct';
                    }
                },
                self::DEFAULT_NOT_AVAILABLE_WITH_COMPANY,
                'base with no declaration methods at all: no brand opinion',
            ],
        ];
    }

    private static function declinedRegistry(
        bool $declinedEnabled,
        ?string $declinedOverride,
        bool $approvedEnabled
    ): object {
        return new class ($declinedEnabled, $declinedOverride, $approvedEnabled) {
            /** @var bool */
            private $declinedEnabled;

            /** @var string|null */
            private $declinedOverride;

            /** @var bool */
            private $approvedEnabled;

            public function __construct(bool $declinedEnabled, ?string $declinedOverride, bool $approvedEnabled)
            {
                $this->declinedEnabled = $declinedEnabled;
                $this->declinedOverride = $declinedOverride;
                $this->approvedEnabled = $approvedEnabled;
            }

            public function isIntentDeclinedNoticeEnabled(): bool
            {
                return $this->declinedEnabled;
            }

            public function getIntentDeclinedNotice(): ?string
            {
                return $this->declinedOverride;
            }

            public function isIntentApprovedNoticeEnabled(): bool
            {
                return $this->approvedEnabled;
            }

            public function getIntentApprovedNotice(): ?string
            {
                return null;
            }

            public function getProductName(): string
            {
                return 'TestProduct';
            }
        };
    }

    private static function legacyRegistry(bool $approvedEnabled): object
    {
        return new class ($approvedEnabled) {
            /** @var bool */
            private $approvedEnabled;

            public function __construct(bool $approvedEnabled)
            {
                $this->approvedEnabled = $approvedEnabled;
            }

            public function isIntentApprovedNoticeEnabled(): bool
            {
                return $this->approvedEnabled;
            }

            public function getIntentApprovedNotice(): ?string
            {
                return null;
            }

            public function getProductName(): string
            {
                return 'TestProduct';
            }
        };
    }

    /**
     * TWO-25326: Hyvä has no setting of its own — the location is the
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
     * TWO-25326: address AUTOFILL requires BOTH the
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

    /**
     * The interface is declared mid-test because both states have to be observed;
     * declaring it is irreversible within a process, hence the separate one.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function testProxyAvailabilityTracksTheBaseModulesOwnInterface(): void
    {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();

        $this->assertFalse(
            $viewModel->getIsProxyAvailable(),
            'a base without the interface predates the routes'
        );

        eval('namespace Two\Gateway\Api\Webapi; interface CompanyLookupInterface {}');
        $this->assertTrue($viewModel->getIsProxyAvailable(), 'interface present');
    }

    /**
     * @dataProvider customHeadersCases
     */
    public function testCustomHeadersAreThreadedFromTheConfigRepository(
        array $configuredHeaders,
        array $expected,
        string $case
    ): void {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();

        $configRepository = new class ($configuredHeaders) {
            /** @var array */
            private $headers;

            public function __construct(array $headers)
            {
                $this->headers = $headers;
            }

            public function getBrowserCustomHeaders(): array
            {
                return $this->headers;
            }
        };

        $reflection->getProperty('configRepository')->setValue($viewModel, $configRepository);

        $this->assertSame($expected, $viewModel->getCustomHeaders(), $case);
    }

    /**
     * @return array<int, array{0:array, 1:array, 2:string}>
     */
    public static function customHeadersCases(): array
    {
        return [
            [[], [], 'nothing configured: empty array'],
            [['X-WAF-TOKEN' => 'tok-abc'], ['X-WAF-TOKEN' => 'tok-abc'], 'configured header: relayed'],
        ];
    }

    /**
     * A base predating getBrowserCustomHeaders() must answer no headers, not fatal.
     */
    public function testCustomHeadersDegradesOnABaseWithoutTheConfigMethod(): void
    {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();

        $configRepository = new class {
            public function getApiKey(): string
            {
                return 'key';
            }
        };

        $reflection->getProperty('configRepository')->setValue($viewModel, $configRepository);

        $this->assertSame([], $viewModel->getCustomHeaders());
    }

    /** No brand opinion means the platform default copy, not a fatal. */
    public function testNoticeSurvivesABrandRegistryWithoutTheDeclarationMethods(): void
    {
        $notice = $this->noticeFor(new class {
            public function getProductName(): string
            {
                return 'TestProduct';
            }
        });

        $this->assertNotNull($notice);
        $this->assertSame(self::DEFAULT_WITH_COMPANY, $notice['withCompany']);
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

    /**
     * @dataProvider duplicatedFieldAttributeCases
     */
    public function testStripDuplicatedFieldAttributes(
        string $rendered,
        string $expected,
        string $case
    ): void {
        $viewModel = (new ReflectionClass(CheckoutConfig::class))->newInstanceWithoutConstructor();

        $this->assertSame($expected, $viewModel->stripDuplicatedFieldAttributes($rendered), $case);
    }

    /**
     * @return array<array{0:string,1:string,2:string}>
     */
    public static function duplicatedFieldAttributeCases(): array
    {
        return [
            [
                'type="text" name="company"',
                'name="company"',
                'type in the first position',
            ],
            [
                'name="company" autocomplete="organization" id="company"',
                'name="company" id="company"',
                'autocomplete between other attributes',
            ],
            [
                'type="text" name="company" autocomplete="organization"',
                'name="company"',
                'both present',
            ],
            [
                'name="company" id="company"',
                'name="company" id="company"',
                'neither present',
            ],
            [
                'data-type="x" name="company" data-autocomplete="y"',
                'data-type="x" name="company" data-autocomplete="y"',
                'attributes merely ending in the stripped names',
            ],
            [
                "type='text' name=\"company\" autocomplete='organization'",
                'name="company"',
                'single-quoted values',
            ],
            [
                'TYPE="text" name="company" AutoComplete="organization"',
                'name="company"',
                'uppercase attribute names',
            ],
            [
                'title="type=\'x\'" name="c" type="text"',
                'title="type=\'x\'" name="c"',
                'stripped name appearing inside another attribute\'s value',
            ],
            [
                'title="a type=\'x\'" name="c" type="text"',
                'title="a type=\'x\'" name="c"',
                'embedded occurrence preceded by a space inside a value',
            ],
            [
                'type=text name="c"',
                'name="c"',
                'unquoted value',
            ],
            [
                "autocomplete='off' name=\"c\"",
                'name="c"',
                'single-quoted value',
            ],
            [
                'required type="text" name="c"',
                'required name="c"',
                'valueless attribute preserved',
            ],
            [
                'name="c" title="unclosed',
                'name="c" title ="unclosed',
                'malformed tail preserved rather than truncated',
            ],
        ];
    }

    /**
     * ABN-496: the explainer link and the subtitle are whatever the base
     * module's CheckoutTileCopy answers — this checkout keeps no rule of its
     * own, so the rows assert delegation rather than the rule.
     *
     * @dataProvider aboutLinkAndSubtitleProvider
     */
    public function testAboutLinkAndSubtitleComeFromTheBaseService(
        bool $visible,
        string $url,
        string $subtitle,
        string $description
    ): void {
        $viewModel = $this->viewModelWithTileCopy($visible, $url, $subtitle);

        $this->assertSame($visible, $viewModel->getShowAboutLink(), $description);
        $this->assertSame($url, $viewModel->getAboutLinkUrl(), $description);
        $this->assertSame($subtitle, $viewModel->getCheckoutSubtitleHtml(), $description);
    }

    /**
     * @return array<array{0:bool,1:string,2:string,3:string}>
     */
    public static function aboutLinkAndSubtitleProvider(): array
    {
        return [
            [
                true,
                'https://example.test/explainer',
                'Pay in 30 days',
                'a visible link and a subtitle reach the template unaltered',
            ],
            [
                false,
                '',
                '',
                'a brand with no URL yields no link and no subtitle',
            ],
        ];
    }

    private function viewModelWithTileCopy(bool $visible, string $url, string $subtitle): CheckoutConfig
    {
        $reflection = new ReflectionClass(CheckoutConfig::class);
        $viewModel = $reflection->newInstanceWithoutConstructor();

        $tileCopy = new class ($visible, $url, $subtitle) extends CheckoutTileCopy {
            /** @var bool */
            private $visible;

            /** @var string */
            private $url;

            /** @var string */
            private $subtitle;

            public function __construct(bool $visible, string $url, string $subtitle)
            {
                $this->visible = $visible;
                $this->url = $url;
                $this->subtitle = $subtitle;
            }

            public function isAboutLinkVisible(): bool
            {
                return $this->visible;
            }

            public function getAboutLinkUrl(): string
            {
                return $this->url;
            }

            public function getSubtitleHtml(): string
            {
                return $this->subtitle;
            }
        };

        $reflection->getProperty('checkoutTileCopy')->setValue($viewModel, $tileCopy);

        return $viewModel;
    }
}
