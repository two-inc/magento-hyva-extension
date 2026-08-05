<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */

declare(strict_types=1);

namespace Two\GatewayHyva\Service;

use Magento\Framework\App\CacheInterface;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Service\Merchant\RecordProvider;

/**
 * Whether the merchant's currently configured API key can be verified right
 * now — the gate the address-block/tile company-search control must respect
 * so it never renders against a key Two cannot actually authenticate
 * (TWO-25326, porting the WooCommerce plugin's API-key-failure-handling fix).
 *
 * This module has no HTTP client of its own, so the check is delegated to
 * the base module's Two\Gateway\Service\Merchant\RecordProvider — the
 * existing verify-then-fetch-then-cache pattern already used for the
 * min-order gate and admin surcharge/terms config, rather than a second,
 * Hyvä-local copy of the same verify_api_key round trip.
 *
 * RecordProvider deliberately caches only a SUCCESSFUL resolution (a
 * failure must not hide a real recovery for up to its own TTL). Left alone,
 * that means a persistent failure re-runs RecordProvider's verify+fetch
 * round trip on every single call — exactly the "naive live check on every
 * page load" latency risk the WooCommerce port of this same fix caught in
 * its own review round, because this can be evaluated inline while
 * rendering checkout. This class adds a short, boolean-only cache on top of
 * that outcome, scoped to this one gate, so a Two outage costs at most one
 * live round trip per CACHE_LIFETIME window here — without touching
 * RecordProvider's own cache contract for its other, unrelated consumers.
 *
 * No base-module service exposing this categorized/cached status existed
 * at the time this was written (checked origin/staging on magento-plugin);
 * if one lands later, this class is the one place to repoint at it.
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
     * @var RecordProvider
     */
    private $recordProvider;

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
     * RecordProvider) more than once, mirroring
     * CheckoutConfig::$api_key_verification_memo-style guards elsewhere in
     * this plugin family.
     *
     * @var bool|null
     */
    private $memo;

    public function __construct(
        RecordProvider $recordProvider,
        ConfigRepository $configRepository,
        CacheInterface $cache
    ) {
        $this->recordProvider = $recordProvider;
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
        if ($this->memo !== null) {
            return $this->memo;
        }

        $apiKey = (string) $this->configRepository->getApiKey($storeId);
        if ($apiKey === '') {
            return $this->memo = false;
        }

        $cacheKey = self::CACHE_KEY_PREFIX . hash('sha256', $apiKey);
        $cached = $this->cache->load($cacheKey);
        if ($cached !== false) {
            return $this->memo = ($cached === '1');
        }

        $verified = $this->recordProvider->getRecord($storeId) !== null;
        $this->cache->save($verified ? '1' : '0', $cacheKey, [], self::CACHE_LIFETIME);

        return $this->memo = $verified;
    }
}
