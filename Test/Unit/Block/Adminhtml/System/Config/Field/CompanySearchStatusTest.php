<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Block\Adminhtml\System\Config\Field;

use Magento\Framework\App\RequestInterface;
use Magento\Store\Model\StoreManagerInterface;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\GatewayHyva\Block\Adminhtml\System\Config\Field\CompanySearchStatus;
use Two\GatewayHyva\Service\ApiKeyVerificationStatus;

/**
 * ABN-518. This extension withholds the company-search control on its own
 * API-key verdict, which the base module's health panel cannot answer for.
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

        $apiKeyStatus = $this->createMock(ApiKeyVerificationStatus::class);
        $apiKeyStatus->expects($this->once())->method('getStatus')->with($expectedStoreId)
            ->willReturn(ApiKeyVerificationStatus::OK);
        $configRepository = $this->createMock(ConfigRepository::class);
        $configRepository->method('isCompanySearchEnabled')->with($expectedStoreId)->willReturn(true);

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
     * (TWO-27224): with the setting off the control moves into the payment
     * tile, which a missing or rejected key withholds too.
     *
     * @return array<string, array{0: string, 1: int|null, 2: bool, 3: string, 4: string, 5: string}>
     */
    public static function verdicts(): array
    {
        return [
            'verified' => [
                ApiKeyVerificationStatus::OK, null, true, 'ok', 'Shown at checkout',
                'a working integration says so',
            ],
            'verified, relocated to the tile' => [
                ApiKeyVerificationStatus::OK, null, false, 'ok', 'Shown in the payment method',
                'the setting off moves the control into the payment method',
            ],
            'no key saved' => [
                ApiKeyVerificationStatus::NOT_CONFIGURED, null, true, 'withheld', 'no API key is saved',
                'an unconfigured install is not a rejected key',
            ],
            'no key saved, relocated to the tile' => [
                ApiKeyVerificationStatus::NOT_CONFIGURED, null, false, 'withheld', 'no API key is saved',
                'the tile it would move into is withheld too',
            ],
            'key rejected' => [
                ApiKeyVerificationStatus::INVALID_KEY, 401, true, 'withheld', 'the API key was rejected',
                'a definitive rejection names both key and environment',
            ],
            'key rejected, relocated to the tile' => [
                ApiKeyVerificationStatus::INVALID_KEY, 401, false, 'withheld', 'the API key was rejected',
                'a rejected key withholds the control in the payment method as well',
            ],
            'service error' => [
                ApiKeyVerificationStatus::SERVICE_ERROR, 503, true, 'ok', 'Shown at checkout',
                'ABN-533: a transient verdict falls through to the cached record',
            ],
            'unreachable' => [
                ApiKeyVerificationStatus::UNREACHABLE, null, true, 'ok', 'Shown at checkout',
                'the same for a store that cannot reach us at all',
            ],
            'unreachable, relocated to the tile' => [
                ApiKeyVerificationStatus::UNREACHABLE, null, false, 'ok', 'Shown in the payment method',
                'an outage falls through to the placement',
            ],
            'other error' => [
                ApiKeyVerificationStatus::ERROR, 404, true, 'ok', 'Shown at checkout',
                'an unclassified status is not evidence the key is wrong',
            ],
        ];
    }

    private function block(
        string $verdictStatus,
        ?int $code,
        bool $companySearchInAddressStep
    ): CompanySearchStatus {
        $reflection = new ReflectionClass(CompanySearchStatus::class);
        $block = $reflection->newInstanceWithoutConstructor();

        $apiKeyStatus = $this->createMock(ApiKeyVerificationStatus::class);
        $apiKeyStatus->method('getStatus')->willReturn($verdictStatus);
        $configRepository = $this->createMock(ConfigRepository::class);
        $configRepository->method('isCompanySearchEnabled')->willReturn($companySearchInAddressStep);

        $request = $this->createMock(RequestInterface::class);
        $request->method('getParam')->willReturn('');

        $reflection->getProperty('apiKeyStatus')->setValue($block, $apiKeyStatus);
        $reflection->getProperty('configRepository')->setValue($block, $configRepository);
        (new \ReflectionProperty($block, '_request'))->setValue($block, $request);

        return $block;
    }
}
