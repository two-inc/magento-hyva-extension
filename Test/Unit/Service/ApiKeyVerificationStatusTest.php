<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Service;

use PHPUnit\Framework\TestCase;
use ReflectionClass;
use Two\Gateway\Model\Cache\Type\TwoGateway;
use Two\GatewayHyva\Service\ApiKeyVerificationStatus;

/**
 * TWO-25326 (WooCommerce-plugin port). Built directly on Adapter
 * (see the class doc on ApiKeyVerificationStatus for why the base module's
 * merchant-record service isn't usable here) — these tests assert (a) the
 * empty/whitespace-only key short-circuit never reaches Adapter at all,
 * (b) success/failure
 * detection off Adapter::execute()'s error_code/http_status contract, (c)
 * the short cache this class adds so a persistent failure does not re-run
 * the live call on every call, (d) the per-store memo, so
 * evaluating this for two different stores in one request can't return
 * one store's verdict for another's, and (e) the cache identifier, cache
 * tag and call timeout (ABN-534).
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

    /**
     * ABN-534. The cache identifier is a sha256 of the operating mode and
     * the API key, so a sandbox verdict and a production verdict for one
     * key occupy separate slots. Digests are literals, not recomputed with
     * the production expression.
     *
     * @dataProvider cacheIdentifierCases
     */
    public function testCacheIdentifierIsComposedOfModeAndApiKey(
        string $mode,
        string $apiKey,
        string $expectedDigest,
        string $description
    ): void {
        $loaded = [];
        $savedTo = [];
        $status = $this->build(
            apiKey: $apiKey,
            execute: fn () => ['id' => 'merchant-1'],
            cacheLoad: function (string $identifier) use (&$loaded) {
                $loaded[] = $identifier;
                return false;
            },
            cacheSave: function (string $value, string $identifier) use (&$savedTo) {
                $savedTo[] = $identifier;
            },
            mode: $mode,
        );

        $status->isVerified();

        $expected = 'two_gatewayhyva_api_key_verified_' . $expectedDigest;
        $this->assertSame([$expected], $loaded, $description);
        $this->assertSame([$expected], $savedTo, $description);
    }

    public static function cacheIdentifierCases(): array
    {
        return [
            ['sandbox', 'shared-key', 'dcfa630905f238a6314cd07ea50d7fefc644430b2a5b1daa455afed911abe3c1', 'sandbox slot for a shared key'],
            ['production', 'shared-key', 'dacb9fbac88129d2b56714415f6a0887b02c34d79abc72aca9fa7d9e026384ad', 'production slot for the same shared key'],
            ['sandbox', 'other-key', '0d5ee347c8df7f1a6de6b391add685cff6ee3d7609ed8143501f087ab8b81e26', 'a key swap moves the slot'],
        ];
    }

    /**
     * ABN-534. One API key, one shared cache backend, two modes: the
     * verdict stored for sandbox must not be served to production. The
     * production instance has to reach the adapter and get its own answer.
     */
    public function testSandboxVerdictIsNotServedToProduction(): void
    {
        $store = [];
        $load = function (string $identifier) use (&$store) {
            return $store[$identifier] ?? false;
        };
        $save = function (string $value, string $identifier) use (&$store) {
            $store[$identifier] = $value;
        };

        $sandbox = $this->build(
            apiKey: 'shared-key',
            execute: fn () => ['id' => 'merchant-1'],
            cacheLoad: $load,
            cacheSave: $save,
            mode: 'sandbox',
        );
        $this->assertTrue($sandbox->isVerified());

        $productionCalls = 0;
        $production = $this->build(
            apiKey: 'shared-key',
            execute: function () use (&$productionCalls) {
                $productionCalls++;
                return ['http_status' => 401];
            },
            cacheLoad: $load,
            cacheSave: $save,
            mode: 'production',
        );

        $this->assertFalse($production->isVerified(), 'production must not read the sandbox verdict');
        $this->assertSame(1, $productionCalls, 'production must reach the adapter for its own verdict');
        $this->assertCount(2, $store, 'the two modes must occupy separate cache identifiers');
        $this->assertSame(['1', '0'], array_values($store));
    }

    /**
     * ABN-534. Without the base module's gateway cache tag,
     * `cache:clean two_gateway` cannot drop a wrong verdict.
     */
    public function testCacheSaveCarriesTheGatewayCacheTag(): void
    {
        $tags = null;
        $status = $this->build(
            apiKey: 'a-valid-key',
            execute: fn () => ['id' => 'merchant-1'],
            cacheSave: function (string $value, string $identifier, array $savedTags) use (&$tags) {
                $tags = $savedTags;
            },
        );

        $status->isVerified();

        $this->assertSame([TwoGateway::CACHE_TAG], $tags);
    }

    /**
     * ABN-534. Adapter's 7th parameter is the timeout; left unset the call
     * inherits the adapter default and can hold a checkout render.
     */
    public function testVerificationCallCarriesAnExplicitTimeout(): void
    {
        $args = null;
        $status = $this->build(
            apiKey: 'a-valid-key',
            execute: function (...$passed) use (&$args) {
                $args = $passed;
                return ['id' => 'merchant-1'];
            },
        );

        $status->isVerified();

        $this->assertCount(7, $args, 'timeout must be passed positionally, so all seven arguments are present');
        $this->assertSame(10, $args[6]);
    }

    private function build(
        string $apiKey,
        callable $execute,
        ?callable $cacheLoad = null,
        ?callable $cacheSave = null,
        string $mode = 'sandbox',
    ): ApiKeyVerificationStatus {
        $reflection = new ReflectionClass(ApiKeyVerificationStatus::class);
        $instance = $reflection->newInstanceWithoutConstructor();

        $configRepository = new class ($apiKey, $mode) {
            /** @var string */
            private $apiKey;

            /** @var string */
            private $mode;

            public function __construct(string $apiKey, string $mode)
            {
                $this->apiKey = $apiKey;
                $this->mode = $mode;
            }

            public function getApiKey(): string
            {
                return $this->apiKey;
            }

            public function getMode(?int $storeId = null): string
            {
                return $this->mode;
            }
        };

        $adapter = new class ($execute) {
            /** @var callable */
            private $execute;

            public function __construct(callable $execute)
            {
                $this->execute = $execute;
            }

            public function execute(...$args): array
            {
                return ($this->execute)(...$args);
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

            public function getMode(?int $storeId = null): string
            {
                return 'sandbox';
            }
        };

        $adapter = new class ($executeForStore) {
            /** @var callable */
            private $executeForStore;

            public function __construct(callable $executeForStore)
            {
                $this->executeForStore = $executeForStore;
            }

            public function execute(string $endpoint, array $payload, string $method, ?int $storeId = null, ...$rest): array
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
                    ($this->onSave)($data, $identifier, $tags, $lifetime);
                }
                return true;
            }
        };
    }
}
