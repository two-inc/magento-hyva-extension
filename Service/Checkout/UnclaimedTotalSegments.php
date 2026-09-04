<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Service\Checkout;

/**
 * Which of a quote's total segments Hyva Checkout's price-summary has no
 * dedicated block for. Framework-free on purpose: Block/Checkout/PriceSummary/
 * OtherTotals.php is the only caller, and keeping this half untyped against
 * Magento lets it be unit-tested with plain stubs (see
 * Test/bootstrap.php's convention for why nothing here requires Magento).
 */
class UnclaimedTotalSegments
{
    /**
     * Codes Hyva Checkout's own core blocks render outside
     * price-summary.total-segments — never duplicate these here.
     */
    private const CORE_CODES = ['subtotal', 'discount', 'shipping', 'tax', 'grand_total'];

    /**
     * @param array<string, object> $totals keyed by total code, each exposing getValue()/getTitle()
     * @param string[] $claimedSiblingCodes codes a sibling block under price-summary.total-segments already renders
     * @return array<int, array{code: string, title: string, value: float}>
     */
    public static function filter(array $totals, array $claimedSiblingCodes): array
    {
        $excluded = array_merge(self::CORE_CODES, $claimedSiblingCodes);
        $unclaimed = [];

        foreach ($totals as $code => $total) {
            if (in_array($code, $excluded, true)) {
                continue;
            }

            // Only a true zero is nothing to reconcile — a negative total
            // (e.g. a fee extension surfacing a credit as a negative
            // amount) is a real line Luma would still render.
            $value = (float) $total->getValue();
            if ($value === 0.0) {
                continue;
            }

            $unclaimed[] = [
                'code' => (string) $code,
                'title' => (string) $total->getTitle(),
                'value' => $value,
            ];
        }

        return $unclaimed;
    }
}
