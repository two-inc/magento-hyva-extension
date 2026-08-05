<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Service;

use PHPUnit\Framework\TestCase;
use ReflectionClass;
use Two\GatewayHyva\Service\ApiKeyVerificationStatus;

/**
 * TWO-25326 (WooCommerce-plugin port, PR #445). Hyvä has no HTTP client of
 * its own, so the live check is delegated to RecordProvider — these tests
 * assert (a) that delegation, (b) the "no key configured" short-circuit
 * never reaches RecordProvider at all, and (c) the short cache this class
 * adds on top so a persistent failure does not re-run RecordProvider's own
 * verify+fetch round trip on every call — the exact latency risk the
 * WooCommerce port's own review round caught (a naive live check inline in
 * a customer-facing request).
 *
 * Built via newInstanceWithoutConstructor() + reflection property injection,
 * matching CheckoutConfigTest's convention in this repo: the constructor's
 * real parameter types (RecordProvider, ConfigRepository, CacheInterface —
 * classes/interfaces from the base module this repo depends on via
 * composer, not present in this repo's own autoloader/stubs) would reject a
 * lightweight anonymous fake at the type-check, so the test never calls the
 * constructor at all.
 */
class ApiKeyVerificationStatusTest extends TestCase
{
    public function testNoApiKeyConfiguredIsFalseAndNeverCallsRecordProvider(): void
    {
        $recordProviderCalls = 0;
        $status = $this->build(
            apiKey: '',
            getRecord: function () use (&$recordProviderCalls) {
                $recordProviderCalls++;
                return ['id' => 'merchant-1'];
            },
        );

        $this->assertFalse($status->isVerified());
        $this->assertSame(0, $recordProviderCalls);
    }

    public function testVerifiedKeyIsTrueWhenRecordProviderResolvesARecord(): void
    {
        $saved = [];
        $status = $this->build(
            apiKey: 'a-valid-key',
            getRecord: fn () => ['id' => 'merchant-1'],
            cacheSave: function (string $value) use (&$saved) {
                $saved[] = $value;
            },
        );

        $this->assertTrue($status->isVerified());
        $this->assertSame(['1'], $saved);
    }

    public function testUnverifiableKeyIsFalseWhenRecordProviderResolvesNull(): void
    {
        $saved = [];
        $status = $this->build(
            apiKey: 'a-broken-key',
            getRecord: fn () => null,
            cacheSave: function (string $value) use (&$saved) {
                $saved[] = $value;
            },
        );

        $this->assertFalse($status->isVerified());
        $this->assertSame(['0'], $saved);
    }

    /**
     * The whole point of this class: a cached outcome (positive OR
     * negative) must not re-trigger RecordProvider's live round trip.
     */
    public function testCachedOutcomeSkipsRecordProviderEntirely(): void
    {
        $recordProviderCalls = 0;
        $status = $this->build(
            apiKey: 'a-broken-key',
            getRecord: function () use (&$recordProviderCalls) {
                $recordProviderCalls++;
                return null;
            },
            cacheLoad: fn () => '0',
        );

        $this->assertFalse($status->isVerified());
        $this->assertSame(0, $recordProviderCalls);
    }

    /**
     * Request-scoped memo: a single instance must not consult the cache
     * twice either, mirroring the memo pattern already used elsewhere in
     * this plugin family (e.g. WC_Twoinc::$api_key_verification_memo).
     */
    public function testMemoizesWithinASingleRequest(): void
    {
        $recordProviderCalls = 0;
        $status = $this->build(
            apiKey: 'a-valid-key',
            getRecord: function () use (&$recordProviderCalls) {
                $recordProviderCalls++;
                return ['id' => 'merchant-1'];
            },
        );

        $this->assertTrue($status->isVerified());
        $this->assertTrue($status->isVerified());
        $this->assertSame(1, $recordProviderCalls);
    }

    private function build(
        string $apiKey,
        callable $getRecord,
        ?callable $cacheLoad = null,
        ?callable $cacheSave = null,
    ): ApiKeyVerificationStatus {
        $reflection = new ReflectionClass(ApiKeyVerificationStatus::class);
        $instance = $reflection->newInstanceWithoutConstructor();

        $configRepository = new class ($apiKey) {
            /** @var string */
            private $apiKey;

            public function __construct(string $apiKey)
            {
                $this->apiKey = $apiKey;
            }

            public function getApiKey(): string
            {
                return $this->apiKey;
            }
        };

        $recordProvider = new class ($getRecord) {
            /** @var callable */
            private $getRecord;

            public function __construct(callable $getRecord)
            {
                $this->getRecord = $getRecord;
            }

            public function getRecord(): ?array
            {
                return ($this->getRecord)();
            }
        };

        $cache = new class ($cacheLoad, $cacheSave) {
            /** @var callable|null */
            private $onLoad;

            /** @var callable|null */
            private $onSave;

            public function __construct(?callable $onLoad, ?callable $onSave)
            {
                $this->onLoad = $onLoad;
                $this->onSave = $onSave;
            }

            /** @return string|bool */
            public function load(string $identifier)
            {
                return $this->onLoad ? ($this->onLoad)($identifier) : false;
            }

            public function save(string $data, string $identifier, array $tags = [], $lifetime = null): bool
            {
                if ($this->onSave) {
                    ($this->onSave)($data);
                }
                return true;
            }
        };

        $reflection->getProperty('recordProvider')->setValue($instance, $recordProvider);
        $reflection->getProperty('configRepository')->setValue($instance, $configRepository);
        $reflection->getProperty('cache')->setValue($instance, $cache);

        return $instance;
    }
}
