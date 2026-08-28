<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Service;

use PHPUnit\Framework\TestCase;
use ReflectionClass;
use Two\GatewayHyva\Service\ApiKeyVerificationStatus;

/**
 * TWO-25326 (WooCommerce-plugin port, PR #445). Built directly on Adapter
 * (see the class doc on ApiKeyVerificationStatus for why the base module's
 * merchant-record service isn't usable here) — these tests assert (a) the
 * empty/whitespace-only key short-circuit never reaches Adapter at all,
 * (b) success/failure
 * detection off Adapter::execute()'s error_code/http_status contract, (c)
 * the short cache this class adds so a persistent failure does not re-run
 * the live call on every call — the exact latency risk the WooCommerce
 * port's own review round caught — and (d) the per-store memo, so
 * evaluating this for two different stores in one request can't return
 * one store's verdict for another's.
 *
 * Built via newInstanceWithoutConstructor() + reflection property
 * injection, matching CheckoutConfigTest's convention in this repo: the
 * constructor's real parameter types (Adapter, ConfigRepository,
 * CacheInterface — classes/interfaces from the base module this repo
 * depends on via composer, not present in this repo's own
 * autoloader/stubs) would reject a lightweight anonymous fake at the
 * type-check, so the test never calls the constructor at all.
 */
class ApiKeyVerificationStatusTest extends TestCase
{
    public function testNoApiKeyConfiguredIsFalseAndNeverCallsAdapter(): void
    {
        $adapterCalls = 0;
        $status = $this->build(
            apiKey: '',
            execute: function () use (&$adapterCalls) {
                $adapterCalls++;
                return ['id' => 'merchant-1'];
            },
        );

        $this->assertFalse($status->isVerified());
        $this->assertSame(0, $adapterCalls);
    }

    /**
     * A key of literal whitespace must not reach Adapter as if it were a
     * real key — it's trimmed to empty and treated as "not configured".
     */
    public function testWhitespaceOnlyApiKeyIsFalseAndNeverCallsAdapter(): void
    {
        $adapterCalls = 0;
        $status = $this->build(
            apiKey: "  \t ",
            execute: function () use (&$adapterCalls) {
                $adapterCalls++;
                return ['id' => 'merchant-1'];
            },
        );

        $this->assertFalse($status->isVerified());
        $this->assertSame(0, $adapterCalls);
    }

    public function testVerifiedKeyIsTrueWhenAdapterReturnsASuccessPayload(): void
    {
        $saved = [];
        $status = $this->build(
            apiKey: 'a-valid-key',
            execute: fn () => ['id' => 'merchant-1', 'short_name' => 'Acme'],
            cacheSave: function (string $value) use (&$saved) {
                $saved[] = $value;
            },
        );

        $this->assertTrue($status->isVerified());
        $this->assertSame(['1'], $saved);
    }

    /**
     * @dataProvider adapterFailureShapes
     */
    public function testUnverifiableKeyIsFalseForEachAdapterFailureShape(array $adapterResult): void
    {
        $saved = [];
        $status = $this->build(
            apiKey: 'a-broken-key',
            execute: fn () => $adapterResult,
            cacheSave: function (string $value) use (&$saved) {
                $saved[] = $value;
            },
        );

        $this->assertFalse($status->isVerified());
        $this->assertSame(['0'], $saved);
    }

    public static function adapterFailureShapes(): array
    {
        return [
            'invalid/expired key (401)' => [['error' => 'invalid_api_key', 'http_status' => 401]],
            'Two 5xx' => [['http_status' => 503]],
            'caught translator/transport failure' => [['error_code' => 400, 'error_message' => 'timed out']],
            // translatorFailure() (Adapter::execute()) sets BOTH keys at
            // once — the shape that would slip through if the check were
            // ever "simplified" to assume the two markers are mutually
            // exclusive.
            'translator failure (both markers set)' => [
                ['error_code' => 502, 'http_status' => 502, 'error_message' => 'translation failed'],
            ],
        ];
    }

    /**
     * The whole point of this class: a cached outcome (positive OR
     * negative) must not re-trigger Adapter's live round trip.
     */
    public function testCachedOutcomeSkipsAdapterEntirely(): void
    {
        $adapterCalls = 0;
        $status = $this->build(
            apiKey: 'a-broken-key',
            execute: function () use (&$adapterCalls) {
                $adapterCalls++;
                return ['http_status' => 503];
            },
            cacheLoad: fn () => '0',
        );

        $this->assertFalse($status->isVerified());
        $this->assertSame(0, $adapterCalls);
    }

    /**
     * Request-scoped memo: a single instance must not consult the cache
     * twice either, mirroring the memo pattern already used elsewhere in
     * this plugin family (e.g. WC_Twoinc::$api_key_verification_memo).
     */
    public function testMemoizesWithinASingleRequest(): void
    {
        $adapterCalls = 0;
        $status = $this->build(
            apiKey: 'a-valid-key',
            execute: function () use (&$adapterCalls) {
                $adapterCalls++;
                return ['id' => 'merchant-1'];
            },
        );

        $this->assertTrue($status->isVerified());
        $this->assertTrue($status->isVerified());
        $this->assertSame(1, $adapterCalls);
    }

    /**
     * The memo (and the cache lookup feeding it) must be keyed per store —
     * evaluating this for store 1 then store 2 in the same request must
     * not let store 1's verdict leak into store 2's answer, and
     * re-querying an already-resolved store must not re-hit the adapter.
     */
    public function testMemoIsScopedPerStoreNotSharedAcrossStores(): void
    {
        $apiKeyByStore = [1 => 'store-1-valid-key', 2 => 'store-2-broken-key'];
        $adapterCallsByStore = [];

        $status = $this->buildMultiStore($apiKeyByStore, function (?int $storeId) use (&$adapterCallsByStore) {
            $adapterCallsByStore[$storeId] = ($adapterCallsByStore[$storeId] ?? 0) + 1;
            return $storeId === 1 ? ['id' => 'merchant-1'] : ['http_status' => 401];
        });

        $this->assertTrue($status->isVerified(1));
        $this->assertFalse($status->isVerified(2));
        // Re-querying store 1 must still be true (not clobbered by store
        // 2's later, different-valued call) and must not re-hit the
        // adapter (memo hit).
        $this->assertTrue($status->isVerified(1));
        $this->assertSame(1, $adapterCallsByStore[1]);
        $this->assertSame(1, $adapterCallsByStore[2]);
    }

    private function build(
        string $apiKey,
        callable $execute,
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

        $adapter = new class ($execute) {
            /** @var callable */
            private $execute;

            public function __construct(callable $execute)
            {
                $this->execute = $execute;
            }

            public function execute(): array
            {
                return ($this->execute)();
            }
        };

        $cache = $this->cacheFake($cacheLoad, $cacheSave);

        $reflection->getProperty('adapter')->setValue($instance, $adapter);
        $reflection->getProperty('configRepository')->setValue($instance, $configRepository);
        $reflection->getProperty('cache')->setValue($instance, $cache);

        return $instance;
    }

    /**
     * @param array<int,string> $apiKeyByStore
     */
    private function buildMultiStore(array $apiKeyByStore, callable $executeForStore): ApiKeyVerificationStatus
    {
        $reflection = new ReflectionClass(ApiKeyVerificationStatus::class);
        $instance = $reflection->newInstanceWithoutConstructor();

        $configRepository = new class ($apiKeyByStore) {
            /** @var array<int,string> */
            private $apiKeyByStore;

            public function __construct(array $apiKeyByStore)
            {
                $this->apiKeyByStore = $apiKeyByStore;
            }

            public function getApiKey(?int $storeId = null): string
            {
                return $this->apiKeyByStore[$storeId] ?? '';
            }
        };

        $adapter = new class ($executeForStore) {
            /** @var callable */
            private $executeForStore;

            public function __construct(callable $executeForStore)
            {
                $this->executeForStore = $executeForStore;
            }

            public function execute(string $endpoint, array $payload, string $method, ?int $storeId = null): array
            {
                return ($this->executeForStore)($storeId);
            }
        };

        $cache = $this->cacheFake(fn () => false, function () {
        });

        $reflection->getProperty('adapter')->setValue($instance, $adapter);
        $reflection->getProperty('configRepository')->setValue($instance, $configRepository);
        $reflection->getProperty('cache')->setValue($instance, $cache);

        return $instance;
    }

    private function cacheFake(?callable $onLoad, ?callable $onSave): object
    {
        return new class ($onLoad, $onSave) {
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
    }
}
