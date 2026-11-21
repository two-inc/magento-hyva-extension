<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Block\Adminhtml\System\Config\Field;

use Magento\Framework\App\RequestInterface;
use Magento\Store\Model\StoreManagerInterface;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\GatewayHyva\Block\Adminhtml\System\Config\Field\CompanySearchStatus;
use Two\Gateway\Service\Merchant\ApiKeyStatus;

/**
 * ABN-518. This extension withholds the company-search control on the base
 * module's API-key verdict, and keeps its own row until a tagged base release
 * carries the base company-search row.
 */
class CompanySearchStatusTest extends TestCase
{
    /**
     * @dataProvider verdicts
     */
    public function testTheRowNamesTheActiveReason(
        string $verdictStatus,
        ?int $code,
        bool $companySearchInAddressStep,
        string $expectedState,
        string $expectedFragment,
        string $description
    ): void {
        $block = $this->block($verdictStatus, $code, $companySearchInAddressStep);
        $row = $block->getStatusRow();

        $this->assertSame($expectedState, $row['state'], $description);
        $this->assertStringContainsString($expectedFragment, $row['value'], $description);
        // A verdict that could not be reached must not be painted as a fault.
        $expectedColour = $expectedState === 'ok' ? '#079633' : '#e02b27';
        $this->assertSame($expectedColour, $block->getStatusColour($row), $description);
    }

    /**
     * @dataProvider scopeParams
     */
    public function testTheRowJudgesTheScopeThePageIsOpenAt(
        string $storeParam,
        string $websiteParam,
        bool $resolves,
        ?int $expectedStoreId,
        string $description
    ): void {
        $reflection = new ReflectionClass(CompanySearchStatus::class);
        $block = $reflection->newInstanceWithoutConstructor();

        $apiKeyStatus = $this->createMock(ApiKeyStatus::class);
        $apiKeyStatus->expects($this->once())->method('getStatus')->with($expectedStoreId)
            ->willReturn(['status' => ApiKeyStatus::OK, 'code' => 200, 'merchant' => null]);
        $configRepository = $this->createMock(ConfigRepository::class);
        $configRepository->method('isCompanySearchEnabled')->with($expectedStoreId)->willReturn(true);
        $configRepository->expects($this->once())->method('isActive')->with($expectedStoreId)->willReturn(true);

        $request = $this->createMock(RequestInterface::class);
        $request->method('getParam')->willReturnCallback(
            static fn ($name) => $name === 'store' ? $storeParam : ($name === 'website' ? $websiteParam : '')
        );

        $store = new class () {
            public function getId()
            {
                return 7;
            }
        };
        $storeManager = $this->createMock(StoreManagerInterface::class);
        if ($resolves) {
            $storeManager->method('getStore')->willReturn($store);
            $storeManager->method('getWebsite')->willReturn(new class ($store) {
                private $store;

                public function __construct($store)
                {
                    $this->store = $store;
                }

                public function getDefaultStore()
                {
                    return $this->store;
                }
            });
        } else {
            $storeManager->method('getStore')
                ->willThrowException(new \Magento\Framework\Exception\NoSuchEntityException());
            $storeManager->method('getWebsite')
                ->willThrowException(new \Magento\Framework\Exception\NoSuchEntityException());
        }

        $reflection->getProperty('apiKeyStatus')->setValue($block, $apiKeyStatus);
        $reflection->getProperty('configRepository')->setValue($block, $configRepository);
        $requestProp = new \ReflectionProperty($block, '_request');
        $requestProp->setValue($block, $request);
        $storeManagerProp = new \ReflectionProperty($block, '_storeManager');
        $storeManagerProp->setValue($block, $storeManager);

        $this->assertSame('ok', $block->getStatusRow()['state'], $description);
    }

    /**
     * @return array<string, array{0: string, 1: string, 2: bool, 3: int|null, 4: string}>
     */
    public static function scopeParams(): array
    {
        return [
            'default scope' => ['', '', true, null, 'no scope param reads the default scope'],
            'store view' => ['7', '', true, 7, 'a store-view page judges that store'],
            'website' => ['', '3', true, 7, "a website page judges the website's default store"],
            'stale store param' => ['999', '', false, null, 'an unresolvable scope degrades, never throws'],
        ];
    }

    /**
     * The verdict decides first, then the setting says where the control sits
     * (TWO-27224). With address entry search off the control lives in the
     * payment tile, so a missing or rejected key keeps it off the page there
     * too, and any other verdict says it shows only where the tile does.
     *
     * @return array<string, array{0: string, 1: int|null, 2: bool, 3: string, 4: string, 5: string}>
     */
    public static function verdicts(): array
    {
        return [
            'verified' => [
                ApiKeyStatus::OK, null, true, 'ok', 'Shown at checkout',
                'a working integration says so',
            ],
            'verified, address entry search off' => [
                ApiKeyStatus::OK, null, false, 'ok', 'Shown in the payment method when it is offered',
                'with address entry search off the row names the tile and its condition',
            ],
            'nothing saved as the key' => [
                ApiKeyStatus::NOT_CONFIGURED, null, true, 'withheld', 'no API key is saved',
                'an install with no key is told to save one',
            ],
            'nothing saved as the key, address entry search off' => [
                ApiKeyStatus::NOT_CONFIGURED, null, false, 'withheld', 'no API key is saved',
                'a missing key keeps the tile, and so the control, off the page',
            ],
            'refused key' => [
                ApiKeyStatus::INVALID_KEY, 401, true, 'withheld', 'the API key was rejected',
                'a refusal points the admin at key and environment',
            ],
            'refused key, address entry search off' => [
                ApiKeyStatus::INVALID_KEY, 401, false, 'withheld', 'the API key was rejected',
                'moving the control into the tile does not escape a rejection',
            ],
            'server-side failure' => [
                ApiKeyStatus::SERVICE_ERROR, 503, true, 'ok', 'Shown at checkout',
                'ABN-533: a transient verdict falls through to the cached record',
            ],
            'server-side failure, address entry search off' => [
                ApiKeyStatus::SERVICE_ERROR, 503, false, 'ok', 'Shown in the payment method when it is offered',
                'a transient verdict in the tile falls through just the same',
            ],
            'API out of reach' => [
                ApiKeyStatus::UNREACHABLE, null, true, 'ok', 'Shown at checkout',
                'and likewise when the API cannot be reached',
            ],
            'API out of reach, address entry search off' => [
                ApiKeyStatus::UNREACHABLE, null, false, 'ok', 'Shown in the payment method when it is offered',
                'losing the API is no reason to report the tile control gone',
            ],
            'unclassified failure' => [
                ApiKeyStatus::ERROR, 404, true, 'ok', 'Shown at checkout',
                'an unclassified status is not evidence the key is wrong',
            ],
            'unclassified failure, address entry search off' => [
                ApiKeyStatus::ERROR, 404, false, 'ok', 'Shown in the payment method when it is offered',
                'nor is it evidence when the control sits in the tile',
            ],
        ];
    }

    /**
     * TWO-27227: a disabled method withholds the control whatever the verdict
     * and wherever the setting places it. Re-enabling is every row of
     * verdicts(), which builds an enabled method.
     *
     * @dataProvider disabledMethodCases
     */
    public function testADisabledMethodWithholdsTheRowWhateverTheVerdict(
        string $verdictStatus,
        bool $companySearchInAddressStep,
        string $description
    ): void {
        $block = $this->block($verdictStatus, null, $companySearchInAddressStep, false);
        $row = $block->getStatusRow();

        $this->assertSame('withheld', $row['state'], $description);
        $this->assertStringContainsString(
            'the payment method is disabled. Check Enable payment method.',
            $row['value'],
            $description
        );
        $this->assertStringStartsWith('Not shown at checkout', $row['value'], $description);
    }

    /**
     * @return array<string, array{0: string, 1: bool, 2: string}>
     */
    public static function disabledMethodCases(): array
    {
        return [
            'disabled, verified' => [ApiKeyStatus::OK, true,
                'a verified key does not keep a disabled method searching'],
            'disabled, verified, address entry search off' => [ApiKeyStatus::OK, false,
                'nor does moving the control into the tile'],
            'disabled, refused key' => [ApiKeyStatus::INVALID_KEY, true,
                'the disabled method is named before the key'],
            'disabled, API out of reach' => [ApiKeyStatus::UNREACHABLE, true,
                'an outage does not reopen it'],
        ];
    }

    private function block(
        string $verdictStatus,
        ?int $code,
        bool $companySearchInAddressStep,
        bool $methodActive = true
    ): CompanySearchStatus {
        $reflection = new ReflectionClass(CompanySearchStatus::class);
        $block = $reflection->newInstanceWithoutConstructor();

        $apiKeyStatus = $this->createMock(ApiKeyStatus::class);
        $apiKeyStatus->method('getStatus')
            ->willReturn(['status' => $verdictStatus, 'code' => $code, 'merchant' => null]);
        $configRepository = $this->createMock(ConfigRepository::class);
        $configRepository->method('isCompanySearchEnabled')->willReturn($companySearchInAddressStep);
        $configRepository->method('isActive')->willReturn($methodActive);

        $request = $this->createMock(RequestInterface::class);
        $request->method('getParam')->willReturn('');

        $reflection->getProperty('apiKeyStatus')->setValue($block, $apiKeyStatus);
        $reflection->getProperty('configRepository')->setValue($block, $configRepository);
        (new \ReflectionProperty($block, '_request'))->setValue($block, $request);

        return $block;
    }
}
