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
 * Whether the merchant's currently configured API key can be verified right
 * now — the gate the address-block/tile company-search control must respect
 * so it never renders against a key Two cannot actually authenticate
 * (TWO-25326, porting the WooCommerce plugin's API-key-failure-handling fix).
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
    private const CACHE_KEY_PREFIX = 'two_gatewayhyva_api_key_verified_';

    /**
     * Seconds. Matches WC_Twoinc::API_KEY_VERIFICATION_TTL in the
     * woocommerce-plugin port of this fix (TWO-25326) — deliberately short,
     * and deliberately applied to a FAILED verification the same as a
     * successful one (unlike the base module's own cache, which only caches
     * success): this is a binary availability gate, not a config-value
     * cache with a safe "not configured" fallback, so both a key that just
     * broke and a key that just got fixed need to surface within minutes,
     * symmetrically. WC_Twoinc applies the same TTL to every outcome for
     * the same reason.
     */
    private const CACHE_LIFETIME = 300;

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
     * @var array<int|string, bool>
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
     * @param int|null $storeId
     *
     * @return bool true only when the currently configured API key was
     *   confirmed verifiable (subject to the short cache above); false for
     *   no key configured, an invalid/expired key, a Two-side error, or an
     *   unreachable Two — this gate does not distinguish those reasons, as
     *   this module has no admin surface of its own to show a reason on.
     */
    public function isVerified(?int $storeId = null): bool
    {
        $memoKey = $storeId ?? '__default__';
        if (isset($this->memo[$memoKey])) {
            return $this->memo[$memoKey];
        }

        $apiKey = trim((string) $this->configRepository->getApiKey($storeId));
        if ($apiKey === '') {
            return $this->memo[$memoKey] = false;
        }

        // The mode decides which host the key is verified against, so two
        // store views sharing a key across sandbox and production must not
        // share one slot. sha256 of the key, never the key itself.
        $cacheKey = self::CACHE_KEY_PREFIX
            . hash('sha256', $this->configRepository->getMode($storeId) . "\0" . $apiKey);
        $cached = $this->cache->load($cacheKey);
        if ($cached !== false) {
            return $this->memo[$memoKey] = ($cached === '1');
        }

        $result = $this->adapter->execute(
            '/v1/merchant/verify_api_key',
            [],
            'GET',
            $storeId,
            null,
            null,
            self::VERIFY_TIMEOUT_SECONDS
        );
        // Adapter::execute() signals a non-2xx response (or a caught
        // request/response translator failure) by adding an `http_status`
        // and/or `error_code` key to the decoded body — either one present
        // (translatorFailure() sets both at once) signals failure; a real
        // 2xx success payload never carries either, matching the same
        // contract the base module relies on for the same endpoint.
        $verified = is_array($result) && !isset($result['error_code']) && !isset($result['http_status']);
        $this->cache->save($verified ? '1' : '0', $cacheKey, self::CACHE_TAGS, self::CACHE_LIFETIME);

        return $this->memo[$memoKey] = $verified;
    }
}
