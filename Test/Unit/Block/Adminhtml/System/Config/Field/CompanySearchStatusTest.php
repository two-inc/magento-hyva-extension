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
        string $expectedState,
        string $expectedFragment,
        string $description
    ): void {
        $block = $this->block($verdictStatus, $code);
        $row = $block->getStatusRow();

        $this->assertSame($expectedState, $row['state'], $description);
        $this->assertStringContainsString($expectedFragment, $row['value'], $description);
        // A verdict that could not be reached must not be painted as a fault.
        $expectedColour = $expectedState === 'ok' ? '#079633' : '#e02b27';
        $this->assertSame($expectedColour, $block->getStatusColour($row), $description);
    }

    /**
     * With company search in the payment tile, the address-step gate this row
     * reports decides nothing — reporting the verdict there would name a
     * setting the merchant has deliberately turned off.
     */
    public function testCompanySearchInThePaymentTileIsNotAWithholding(): void
    {
        $row = $this->block(ApiKeyVerificationStatus::INVALID_KEY, 401, false)->getStatusRow();

        $this->assertSame('ok', $row['state']);
        $this->assertStringContainsString('Shown in the payment method', $row['value']);
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
     * @return array<string, array{0: string, 1: int|null, 2: string, 3: string, 4: string}>
     */
    public static function verdicts(): array
    {
        return [
            'verified' => [
                ApiKeyVerificationStatus::OK, null, 'ok', 'Shown at checkout',
                'a working integration says so',
            ],
            'no key saved' => [
                ApiKeyVerificationStatus::NOT_CONFIGURED, null, 'withheld', 'no API key is saved',
                'an unconfigured install is not a rejected key',
            ],
            'key rejected' => [
                ApiKeyVerificationStatus::INVALID_KEY, 401, 'withheld', 'the API key was rejected',
                'a definitive rejection names both key and environment',
            ],
            'service error' => [
                ApiKeyVerificationStatus::SERVICE_ERROR, 503, 'ok', 'Shown at checkout',
                'ABN-533: a transient verdict falls through to the cached record',
            ],
            'unreachable' => [
                ApiKeyVerificationStatus::UNREACHABLE, null, 'ok', 'Shown at checkout',
                'the same for a store that cannot reach us at all',
            ],
            'other error' => [
                ApiKeyVerificationStatus::ERROR, 404, 'ok', 'Shown at checkout',
                'an unclassified status is not evidence the key is wrong',
            ],
        ];
    }

    private function block(
        string $verdictStatus,
        ?int $code,
        bool $companySearchInAddressStep = true
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
