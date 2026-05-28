<?php

declare(strict_types=1);

namespace Two\GatewayHyva\ViewModel;

use Magento\Framework\Phrase;
use Magento\Framework\View\Element\Block\ArgumentInterface;

/**
 * Brand-aware values surfaced into Hyva templates. The default DI binding
 * resolves to {@see TwoBrandedHyvaViewModel}; brand overlays (e.g.
 * ABN_GatewayHyva) override via etc/frontend/di.xml preference.
 *
 * Values returned MUST be install-stable across renders so that Hyva's
 * sha256-based inline-script CSP hashes remain valid — see
 * deployment-risk-review-2026-05-27.md §5 "CSP-safe" for the protocol.
 */
interface BrandedHyvaViewModelInterface extends ArgumentInterface
{
    /**
     * Prefix used to namespace Alpine.data() registrations and factory
     * names. Example: "two" yields "twoGatewayHyvaPaymentMethodBase".
     */
    public function getAlpineFnPrefix(): string;

    /**
     * DOM id attribute for the brand's payment form root element.
     */
    public function getFormId(): string;

    /**
     * Magento payment-method code (matches payment/<code>/code in
     * etc/config.xml).
     */
    public function getMethodCode(): string;

    /**
     * Magewire block name used in JS `Magewire.find()` lookups and in
     * Hyva navigation task identifiers. Mirrors the block name declared
     * in view/frontend/layout/hyva_checkout_components.xml.
     */
    public function getMagewireBlockName(): string;

    /**
     * Rendered payment-terms acceptance message shown beside the T&C
     * checkbox in the Hyva checkout. The return may contain HTML (e.g.
     * an anchor wrapping the terms link). Brand overlays own the full
     * sentence so the structure can differ across brands (some brands
     * may omit the link, change wording, or render brand-specific
     * regulatory language).
     *
     * @param string $termsLink Absolute URL to the brand's terms page,
     *     supplied by the caller so the interface stays free of
     *     ConfigRepository dependencies.
     * @param string $brandTermsName Human-readable phrase used as the
     *     anchor text in brands that render a link (e.g. "Two terms
     *     and conditions").
     */
    public function getPaymentTermsMessage(string $termsLink, string $brandTermsName): Phrase;
}
