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
    private const DEFAULT_WITH_COMPANY =
        'Your invoice with TestProduct is likely to be accepted for {{companyName}}, subject to additional checks.';

    private const DEFAULT_WITHOUT_COMPANY =
        'Your invoice with TestProduct is likely to be accepted, subject to additional checks.';

    public function testSwitchEnabledReturnsDefaultCopy(): void
    {
        $notice = $this->noticeFor($this->registry(true, null));

        $this->assertNotNull($notice);
        $this->assertSame(self::DEFAULT_WITH_COMPANY, $notice['withCompany']);
        $this->assertSame(self::DEFAULT_WITHOUT_COMPANY, $notice['withoutCompany']);
        $this->assertSame(CheckoutConfig::COMPANY_NAME_TOKEN, $notice['companyNameToken']);
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
}
