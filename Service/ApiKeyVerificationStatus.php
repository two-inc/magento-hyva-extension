<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */

declare(strict_types=1);

namespace Two\GatewayHyva\Service;

use Magento\Framework\App\CacheInterface;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Model\Cache\Type\TwoGateway;
use Two\Gateway\Service\Api\Adapter;

/**
 * The cached, categorised outcome of verifying the merchant's currently
 * configured API key — the gate the address-block/tile company-search control
 * respects so it never renders against a key Two has rejected (TWO-25326).
 *
 * The categories and the mapping onto them mirror the base module's
 * Two\Gateway\Service\Merchant\ApiKeyStatus; keep them in step until the
 * swap below is possible.
 *
 * Built directly on Adapter rather than the base module's merchant-record
 * service — see the note above the constructor for why. Mirrors this repo's
 * own AGENTS.md precedent for Model\Provenance: a base-module class not yet
 * in a release gets a small local equivalent, not a dependency on it, until
 * a release exists. As with Provenance, once a `two-inc/magento2` release
 * carries an equivalent categorized/cached status service and this module's
 * composer constraint has a floor at that release, delete this class and
 * inject the base one instead.
 */
class ApiKeyVerificationStatus
{
    /** The key verified: a 2xx carrying a merchant id. */
    public const OK = 'ok';

    /** HTTP 401/403 — the key was rejected. */
    public const INVALID_KEY = 'invalid_key';

    /** HTTP 5xx — the service failed; the key may well be fine. */
    public const SERVICE_ERROR = 'service_error';

    /** No HTTP exchange completed: DNS, TLS, routing, connection or timeout. */
    public const UNREACHABLE = 'unreachable';

    /** Some other non-2xx status. */
    public const ERROR = 'error';

    /** A 2xx response that did not carry a merchant id. */
    public const MALFORMED_RESPONSE = 'malformed_response';

    /** No API key saved — nothing to verify. */
    public const NOT_CONFIGURED = 'not_configured';

    private const CACHE_KEY_PREFIX = 'two_gatewayhyva_api_key_status_';

    /** Guards against reading a cache slot written in some other shape. */
    private const CATEGORIES = [
        self::OK,
        self::INVALID_KEY,
        self::SERVICE_ERROR,
        self::UNREACHABLE,
        self::ERROR,
        self::MALFORMED_RESPONSE,
        self::NOT_CONFIGURED,
    ];

    /** Seconds a verified key is served from cache, so a revocation surfaces in minutes. */
    private const CACHE_LIFETIME = 300;

    /**
     * Seconds a failure is served from cache. Shorter, and the same figure as
     * the base ApiKeyStatus, so a corrected key restores the payment method
     * and this control together rather than 240 seconds apart. Still long
     * enough that an outage costs one verification per store per minute.
     */
    private const FAILURE_CACHE_LIFETIME = 60;

    /** Tagged with the base module's gateway cache type so `cache:clean two_gateway` drops the verdict. */
    private const CACHE_TAGS = [TwoGateway::CACHE_TAG];

    /** Seconds. This call sits on a checkout render, so a verification may not outlast a page. */
    private const VERIFY_TIMEOUT_SECONDS = 10;

    /**
     * @var Adapter
     */
    private $adapter;

    /**
     * @var ConfigRepository
     */
    private $configRepository;

    /**
     * @var CacheInterface
     */
    private $cache;

    /**
     * Request-scoped memo so a single render never consults the cache (or
     * fires a live call) more than once per store — keyed like the cache
     * itself (by store id, defaulting to a sentinel for "no store given")
     * rather than a single flat scalar, so evaluating this for two
     * different stores within one request can never return one store's
     * verdict for another's.
     *
     * @var array<int|string, string>
     */
    private $memo = [];

    public function __construct(
        Adapter $adapter,
        ConfigRepository $configRepository,
        CacheInterface $cache
    ) {
        $this->adapter = $adapter;
        $this->configRepository = $configRepository;
        $this->cache = $cache;
    }

    /**
     * The verification category for the stored key, verifying live only on a
     * cache miss.
     */
    public function getStatus(?int $storeId = null): string
    {
        $memoKey = $storeId ?? '__default__';
        if (isset($this->memo[$memoKey])) {
            return $this->memo[$memoKey];
        }

        $apiKey = trim((string) $this->configRepository->getApiKey($storeId));
        if ($apiKey === '') {
            return $this->memo[$memoKey] = self::NOT_CONFIGURED;
        }

        // The mode decides which host the key is verified against, so two
        // store views sharing a key across sandbox and production must not
        // share one slot. sha256 of the key, never the key itself.
        $cacheKey = self::CACHE_KEY_PREFIX
            . hash('sha256', $this->configRepository->getMode($storeId) . "\0" . $apiKey);
        $cached = $this->cache->load($cacheKey);
        if (in_array($cached, self::CATEGORIES, true)) {
            return $this->memo[$memoKey] = (string) $cached;
        }

        $status = self::categorize($this->adapter->execute(
            '/v1/merchant/verify_api_key',
            [],
            'GET',
            $storeId,
            null,
            null,
            self::VERIFY_TIMEOUT_SECONDS
        ));
        $this->cache->save(
            $status,
            $cacheKey,
            self::CACHE_TAGS,
            $status === self::OK ? self::CACHE_LIFETIME : self::FAILURE_CACHE_LIFETIME
        );

        return $this->memo[$memoKey] = $status;
    }

    /**
     * True only for a DEFINITIVE rejection: Two said no, or there is no key to
     * say no to. ABN-533 — an unreachable or erroring Two says nothing about
     * the key, and standing the company-search control down for it removed a
     * working affordance from a correctly configured shop for the length of
     * every upstream incident.
     */
    public function isDefinitiveFailure(?int $storeId = null): bool
    {
        $status = $this->getStatus($storeId);

        return $status === self::INVALID_KEY || $status === self::NOT_CONFIGURED;
    }

    /**
     * Adapter::execute() signals a non-2xx by adding `http_status` and a
     * transport or translator failure by adding `error_code`; translatorFailure()
     * sets both, so `http_status` is read first and wins. A 2xx success payload
     * carries neither and answers with the merchant `id`.
     *
     * @param array<string,mixed> $result
     */
    private static function categorize(array $result): string
    {
        if (isset($result['http_status'])) {
            $code = (int) $result['http_status'];
            if ($code === 401 || $code === 403) {
                return self::INVALID_KEY;
            }

            return $code >= 500 ? self::SERVICE_ERROR : self::ERROR;
        }
        if (isset($result['error_code'])) {
            return self::UNREACHABLE;
        }
        $id = $result['id'] ?? null;

        return is_string($id) && $id !== '' ? self::OK : self::MALFORMED_RESPONSE;
    }
}
