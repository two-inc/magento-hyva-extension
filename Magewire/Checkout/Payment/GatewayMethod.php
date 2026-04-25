<?php

/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Magewire\Checkout\Payment;

use Magento\Checkout\Model\Session;
use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\Exception\NoSuchEntityException;
use Magento\Quote\Api\CartRepositoryInterface;
use Magewirephp\Magewire\Component;
use Two\Gateway\Api\Webapi\TermSelectionInterface;
use Two\Gateway\Model\Ui\ConfigProvider as UpstreamConfigProvider;

/**
 * GatewayMethod - Hyvä Checkout
 */
class GatewayMethod extends Component
{
    public array $quoteInformations = [];

    public string $countryCode = "";

    /**
     * Per-term `{days: fee}` map. Magewire-synced public property so the
     * client always sees the latest values after any re-render. Populated in
     * `mount()` from the upstream config (which is computed against the
     * current cart) and refreshed by `selectTerm()` after the webapi call.
     *
     * Solves the chip-vs-summary mismatch where the chip showed a stale
     * fee from page load while the cart summary used the freshly-collected
     * `two_surcharge` total.
     *
     * @var array<int|string, float|int|string>
     */
    public array $termSurcharges = [];

    protected $loader = true;

    public function __construct(
        private Session $checkoutSession,
        private CartRepositoryInterface $quoteRepository,
        private TermSelectionInterface $termSelection,
        private UpstreamConfigProvider $upstreamConfig,
    ) {}

    /**
     * @throws LocalizedException
     * @throws NoSuchEntityException
     */
    public function mount(): void
    {
        $quote = $this->checkoutSession->getQuote();

        $this->quoteInformations = [
            "country_id" => $quote->getBillingAddress()->getCountryId(),
            "currency_code" => $quote->getQuoteCurrencyCode(),
            "base_grand_total" => $quote->getGrandTotal(),
        ];

        $this->refreshTermSurcharges();
    }

    /**
     * Read fresh `{days: fee}` from the upstream config provider, which
     * computes against the current cart state. Called from `mount()` (every
     * Magewire render) and `selectTerm()` (after the webapi recalculates).
     */
    private function refreshTermSurcharges(): void
    {
        $config = $this->upstreamConfig->getConfig();
        $this->termSurcharges = (array)($config['payment']['two_payment']['termSurcharges'] ?? []);
    }

    /**
     * @throws LocalizedException
     * @throws NoSuchEntityException
     */
    public function setPaymentData(array $value): void
    {
        $quote = $this->checkoutSession->getQuote();
        $payment = $quote->getPayment();
        $payment->setAdditionalInformation($value["additionalData"]);
        $quote->setPayment($payment);
        $this->quoteRepository->save($quote);
    }

    /**
     * Persist the buyer's selected net-terms choice via the upstream webapi
     * and refresh the per-term surcharge map.
     *
     * The webapi writes `$checkoutSession->setTwoSelectedTerm()` and triggers
     * `$quote->collectTotals()` + `$quoteRepository->save()` internally
     * (see Two\Gateway\Model\Webapi\TermSelection::selectTerm). After it
     * returns, the upstream config provider sees the recalculated values, so
     * we re-read it to keep `$termSurcharges` aligned with what the cart
     * summary will show. Without this refresh, chip labels held the page-load
     * fee while the order total used the freshly-collected one.
     *
     * Validates `$days` against the buyer's available terms before dispatching
     * to the webapi — defends against client-supplied junk (negative, zero,
     * or off-list values) reaching the session writer, which itself does no
     * validation. Also lets the Alpine layer treat any thrown
     * `LocalizedException` as a signal to roll back its optimistic UI update.
     *
     * @throws LocalizedException if $days is not in the merchant-configured term list
     */
    public function selectTerm(int $days): array
    {
        $available = array_column((array)$this->upstreamConfig->getConfig()['payment']['two_payment']['availableBuyerTerms'] ?? [], 'days');
        if (!in_array($days, array_map('intval', $available), true)) {
            throw new LocalizedException(__('Invalid payment term selection.'));
        }
        $cartId = (string)$this->checkoutSession->getQuote()->getId();
        $this->termSelection->selectTerm($cartId, $days);
        $this->refreshTermSurcharges();
        return ['term_surcharges' => $this->termSurcharges];
    }
}
