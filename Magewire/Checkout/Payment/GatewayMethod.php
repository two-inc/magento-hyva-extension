<?php

/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Magewire\Checkout\Payment;

use Magento\Checkout\Model\Session;
use Magento\Framework\Exception\InputException;
use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\Exception\NoSuchEntityException;
use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Api\CartTotalRepositoryInterface;
use Magewirephp\Magewire\Component;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Api\Log\RepositoryInterface as LogRepository;
use Two\Gateway\Model\Config\Source\SurchargeType;
use Two\Gateway\Service\Order\SurchargeCalculator;

/**
 * GatewayMethod - Hyvä Checkout
 *
 * Drives the buyer-terms chip selector embedded in the payment method
 * block. State is server-rendered on mount() and refreshed via
 * selectTerm() round-trips. Refresh of the order summary after a term
 * change rides the existing `payment_method_selected` Magewire emit,
 * which Hyvä's PriceSummary already listens to.
 */
class GatewayMethod extends Component
{
    public array $quoteInformations = [];

    public string $countryCode = "";

    public array $availableTerms = [];

    public int $selectedTerm = 0;

    /** @var array<int, float> days => net surcharge */
    public array $termSurcharges = [];

    public string $surchargeDescription = '';

    public string $currencyCode = '';

    public bool $showChip = false;

    protected $loader = true;

    /**
     * Magewire listeners — chip fees rebase when totals-affecting state
     * changes elsewhere in checkout. PriceSummary subscribes to a similar
     * set; we mirror them so the chip stays consistent with the summary.
     */
    protected $listeners = [
        'shipping_address_saved' => 'refreshTermSurcharges',
        'shipping_address_activated' => 'refreshTermSurcharges',
        'billing_address_saved' => 'refreshTermSurcharges',
        'billing_address_activated' => 'refreshTermSurcharges',
        'shipping_method_selected' => 'refreshTermSurcharges',
        'coupon_code_applied' => 'refreshTermSurcharges',
        'coupon_code_revoked' => 'refreshTermSurcharges',
    ];

    public function __construct(
        private Session $checkoutSession,
        private CartRepositoryInterface $quoteRepository,
        private CartTotalRepositoryInterface $cartTotalRepository,
        private ConfigRepository $configRepository,
        private SurchargeCalculator $surchargeCalculator,
        private LogRepository $logRepository,
        private string $methodCode = 'two_payment',
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
        // boot() runs on the same initial round-trip and calls
        // hydrateChipState(); skip duplicate call here.
    }

    /**
     * Boot is called on every Magewire round-trip; refresh chip state so
     * stale public properties don't survive shipping/coupon changes that
     * fire while the chip is on screen.
     */
    public function boot(): void
    {
        $this->hydrateChipState();
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
     * Buyer selected a payment term via chip click. Persists to session,
     * forces collectTotals so the surcharge segment recomputes, emits the
     * canonical refresh signal Hyvä's PriceSummary listens for.
     */
    public function selectTerm(int $days): void
    {
        $storeId = (int) $this->checkoutSession->getQuote()->getStoreId();
        // Repository may return string values (e.g. ['14', '30']);
        // normalise to int so strict-mode `in_array` matches `$days`.
        $allowedTerms = array_map('intval', $this->configRepository->getAllBuyerTerms($storeId));

        if (! in_array($days, $allowedTerms, true)) {
            throw new InputException(__('Selected payment term is not available.'));
        }

        $previousTerm = (int) $this->checkoutSession->getTwoSelectedTerm();
        $this->checkoutSession->setTwoSelectedTerm($days);

        try {
            $quote = $this->checkoutSession->getQuote();
            $quote->collectTotals();
            $this->quoteRepository->save($quote);
        } catch (\Exception $e) {
            // Persistence failed — restore prior session term so the chip
            // does not lie about the active selection on next render.
            $this->checkoutSession->setTwoSelectedTerm($previousTerm);
            $this->logRepository->addErrorLog('Hyva chip: selectTerm save failed', $e->getMessage());
            $this->hydrateChipState();
            throw new LocalizedException(__('Could not update payment term. Please try again.'));
        }

        $this->hydrateChipState();

        // PriceSummary listens for payment_method_selected; emitting it
        // with the unchanged method code triggers a summary refresh while
        // the payment-activate JS hook short-circuits (idempotent — checks
        // previousActivePaymentMethod.code).
        $currentMethod = (string) ($quote->getPayment()->getMethod() ?: $this->methodCode);
        $this->emit('payment_method_selected', ['method' => $currentMethod]);
    }

    /**
     * Magewire listener: recompute chip fees when external state shifts
     * the totals basis (address/shipping/coupon changes).
     */
    public function refreshTermSurcharges(): void
    {
        $this->hydrateChipState();
    }

    /**
     * Populate public properties from the persisted quote + config. Safe
     * to call repeatedly; no side effects on the quote.
     */
    private function hydrateChipState(): void
    {
        try {
            $quote = $this->checkoutSession->getQuote();
            $storeId = (int) $quote->getStoreId();
            $type = $this->configRepository->getSurchargeType($storeId);
            $terms = array_values(array_map('intval', $this->configRepository->getAllBuyerTerms($storeId)));

            $this->availableTerms = $terms;
            $this->surchargeDescription = (string) $this->configRepository->getSurchargeLineDescription($storeId);
            $this->currencyCode = (string) ($quote->getQuoteCurrencyCode() ?: $quote->getStore()->getBaseCurrencyCode());

            $sessionTerm = (int) $this->checkoutSession->getTwoSelectedTerm();
            $defaultTerm = (int) $this->configRepository->getDefaultPaymentTerm($storeId);
            $this->selectedTerm = $sessionTerm > 0 ? $sessionTerm : $defaultTerm;

            $this->showChip = $type !== SurchargeType::NONE && count($terms) > 0;
            $this->termSurcharges = $this->showChip ? $this->computeAllTermSurcharges($quote, $terms) : [];
        } catch (\Exception $e) {
            $this->logRepository->addErrorLog('Hyva chip: hydrate failed', $e->getMessage());
            $this->showChip = false;
            $this->availableTerms = [];
            $this->termSurcharges = [];
            $this->currencyCode = '';
        }
    }

    /**
     * Calculator basis matches the read-only Surcharges webapi endpoint:
     * persisted grand_total minus the surcharge segment we just wrote.
     * That excludes our own contribution so chip-to-chip switches don't
     * compound.
     */
    private function computeAllTermSurcharges(\Magento\Quote\Model\Quote $quote, array $terms): array
    {
        $surchargeGross = (float) $this->checkoutSession->getTwoSurchargeGross();
        $basis = (float) $quote->getGrandTotal() - $surchargeGross;
        if ($basis <= 0) {
            return [];
        }

        $storeId = (int) $quote->getStoreId();
        $currency = $quote->getQuoteCurrencyCode() ?: $quote->getStore()->getBaseCurrencyCode();
        $country = $this->resolveCountry($quote);

        $surcharges = [];
        foreach ($terms as $days) {
            try {
                $result = $this->surchargeCalculator->calculate($basis, $days, $country, $currency, $storeId);
                $surcharges[$days] = (float) $result['amount'];
            } catch (\Exception $e) {
                $this->logRepository->addErrorLog(
                    sprintf('Hyva chip: term %d calc failed', $days),
                    $e->getMessage()
                );
                $surcharges[$days] = 0.0;
            }
        }

        return $surcharges;
    }

    /**
     * Resolve buyer country in precedence order: billing, shipping, store
     * default (`general/country/default`). Returns empty string if none
     * are set — caller's try/catch around SurchargeCalculator zeros the
     * preview fee for that term rather than guessing a region.
     */
    private function resolveCountry(\Magento\Quote\Model\Quote $quote): string
    {
        $billing = $quote->getBillingAddress();
        if ($billing && $billing->getCountryId()) {
            return $billing->getCountryId();
        }
        $shipping = $quote->getShippingAddress();
        if ($shipping && $shipping->getCountryId()) {
            return $shipping->getCountryId();
        }
        return (string) $quote->getStore()->getConfig('general/country/default');
    }
}
