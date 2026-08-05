<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */

declare(strict_types=1);

namespace Two\GatewayHyva\Service;

use Magento\Framework\App\CacheInterface;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Service\Api\Adapter;

/**
 * Whether the merchant's currently configured API key can be verified right
 * now — the gate the address-block/tile company-search control must respect
 * so it never renders against a key Two cannot actually authenticate
 * (TWO-25326, porting the WooCommerce plugin's API-key-failure-handling fix).
 *
 * Built directly on Adapter — already injected elsewhere in this module
 * (ViewModel\CheckoutConfig::getOrderIntentConfig()) for the exact same
 * `/v1/merchant/verify_api_key` endpoint — rather than the base module's
 * Two\Gateway\Service\Merchant\RecordProvider, which would have been the
 * more natural existing verify+fetch+cache pattern to reuse. RecordProvider
 * is NOT usable here: it exists only on magento-plugin's `origin/staging`,
 * not in any published `two-inc/magento2` release this module's composer
 * constraint (`^2.0`) can resolve, and depending on it breaks
 * `setup:di:compile` on every base version a merchant can currently install
 * (caught by this PR's own CI, di-compile job, PHP 8.3 leg). This mirrors
 * the documented precedent in this repo's AGENTS.md for
 * Model\Provenance — a base-module class not yet in a release gets a
 * small local equivalent, not a dependency on it, until a release exists.
 *
 * The failure-detection check below (`error_code` / `http_status` markers)
 * duplicates a few lines of Adapter::execute()'s own documented contract,
 * which RecordProvider also duplicates for the same reason: Adapter itself
 * has no boolean "did this succeed" helper.
 *
 * Adapter::execute() catches every Throwable internally and always returns
 * an array (see its own catch-all in magento-plugin), so this class needs
 * no try/catch of its own around the live call.
 *
 * Caches the categorized-into-boolean outcome for CACHE_LIFETIME seconds,
 * keyed on the API key, so a Two outage costs at most one live round trip
 * per key per TTL window rather than one per checkout render — the "naive
 * live check on every page load" latency risk the WooCommerce port of this
 * same fix (PR #445) caught in its own review round, and which
 * getOrderIntentConfig() above still has today (pre-existing, out of this
 * PR's scope).
 */
class ApiKeyVerificationStatus
{
    private const CACHE_KEY_PREFIX = 'two_gatewayhyva_api_key_verified_';

    /**
     * Seconds. Matches WC_Twoinc::API_KEY_VERIFICATION_TTL in the
     * woocommerce-plugin port of this fix (TWO-25326) — a wrong key or an
     * outage should surface within minutes, not sit behind a long TTL.
     */
    private const CACHE_LIFETIME = 300;

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

        $cacheKey = self::CACHE_KEY_PREFIX . hash('sha256', $apiKey);
        $cached = $this->cache->load($cacheKey);
        if ($cached !== false) {
            return $this->memo[$memoKey] = ($cached === '1');
        }

        $result = $this->adapter->execute('/v1/merchant/verify_api_key', [], 'GET', $storeId);
        // Adapter::execute() signals a non-2xx response (or a caught
        // request/response translator failure) by adding an `http_status`
        // or `error_code` key to the decoded body — never both alongside a
        // real success payload — so their absence is a real, 2xx merchant
        // record, matching the same contract magento-plugin's own
        // RecordProvider relies on for the same endpoint.
        $verified = is_array($result) && !isset($result['error_code']) && !isset($result['http_status']);
        $this->cache->save($verified ? '1' : '0', $cacheKey, [], self::CACHE_LIFETIME);

        return $this->memo[$memoKey] = $verified;
    }
}
