<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Block\Checkout\PriceSummary;

use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\View\Element\Template;
use Magento\Framework\View\Element\Template\Context;
use Two\GatewayHyva\Service\Checkout\UnclaimedTotalSegments;

/**
 * Hyva Checkout only renders a total segment that has its own explicit
 * block under price-summary.total-segments (docs.hyva.io's own example for
 * adding a custom total is exactly that registration) — there is no
 * generic fallback the way Luma's totals-default component covers any
 * collected total automatically. A third-party fee extension therefore
 * shows nothing here unless it ships its own Hyva-compat block, e.g.
 * Amasty's separate amasty/module-extrafee-hyva-checkout package.
 *
 * This block is that fallback: it renders every quote total NOT already
 * covered by a dedicated block, so a merchant running a fee extension
 * with no (or a broken) Hyva registration still sees the correct line
 * items, matching what Luma already shows from the same quote.
 */
class OtherTotals extends Template
{
    public function __construct(
        Context $context,
        private CheckoutSession $checkoutSession,
        array $data = []
    ) {
        parent::__construct($context, $data);
    }

    /**
     * @return array<int, array{code: string, title: string, value: float}>
     */
    public function getUnclaimedSegments(): array
    {
        try {
            $totals = $this->checkoutSession->getQuote()->getTotals();
        } catch (LocalizedException $exception) {
            return [];
        }

        return UnclaimedTotalSegments::filter($totals, $this->claimedSiblingCodes());
    }

    /**
     * Sibling block aliases already registered under the same
     * price-summary.total-segments container — each one is a code some
     * other block (ours, or an extension's own Hyva-compat module)
     * explicitly renders already.
     *
     * @return string[]
     */
    private function claimedSiblingCodes(): array
    {
        $parentBlock = $this->getParentBlock();
        if (!$parentBlock) {
            return [];
        }

        $siblings = $this->getLayout()->getChildBlocks($parentBlock->getNameInLayout());

        return array_values(array_diff(array_keys($siblings), [$this->getNameInLayout()]));
    }
}
