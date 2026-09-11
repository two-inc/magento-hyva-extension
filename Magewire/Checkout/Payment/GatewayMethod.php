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
use Magento\Framework\Locale\ResolverInterface as LocaleResolver;
use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Api\CartTotalRepositoryInterface;
use Magewirephp\Magewire\Component;
use Two\Gateway\Api\Config\RepositoryInterface as ConfigRepository;
use Two\Gateway\Api\Log\RepositoryInterface as LogRepository;
use Two\Gateway\Model\Config\Source\PaymentTermsType;
use Two\Gateway\Model\Config\Source\SurchargeType;
use Two\Gateway\Service\Order\SurchargeDisplay;
use Two\Gateway\Service\Order\TermSurchargePreview;

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

    /**
     * days => displayed surcharge amount (net or gross, per tax/cart_display/price
     * — same excl/incl resolution as the order-summary segment; "both" stays net,
     * matching magento-plugin's own chip-vs-summary split for that mode)
     *
     * @var array<int, float>
     */
    public array $termSurcharges = [];

    public string $surchargeDescription = '';

    public string $currencyCode = '';

    /**
     * Magento store-view locale (e.g. `nl_NL`, `en_GB`), normalised
     * to BCP-47 (`nl-NL`, `en-GB`) and passed to the chip's
     * Intl.NumberFormat so the surcharge currency renders in the
     * same format Magento uses for the order-summary line items
     * — avoiding the buyer-visible inconsistency where the chip
     * shows `€16.03` (browser default) while the summary shows
     * `€ 16,03` (Magento Dutch format).
     */
    public string $currencyLocale = '';

    public bool $showChip = false;

    public bool $showSingleTerm = false;

    /**
     * Whether the merchant offers end-of-month terms, which fall due that many
     * days after the end of the month rather than from the invoice. The chip
     * text depends on it: a bare day count states the wrong due date for one.
     */
    public bool $isEndOfMonth = false;

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
        private TermSurchargePreview $termSurchargePreview,
        private LogRepository $logRepository,
        private LocaleResolver $localeResolver,
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
            // Magewire's ComponentManager::processUpdates re-wraps every
            // thrown exception as a generic LocalizedException, which the
            // Livewire controller's outer catch can no longer recognise as
            // 4xx — the response is always 500. Dispatch a flash message
            // and return: HTTP stays 200, the buyer sees the validation
            // text via the messenger, and no spurious 500 hits the logs.
            $this->dispatchErrorMessage(__('Selected payment term is not available.'));
            return;
        }

        $previousTerm = (int) $this->checkoutSession->getTwoSelectedTerm();
        $this->checkoutSession->setTwoSelectedTerm($days);

        try {
            $quote = $this->reprice();
        } catch (\Exception $e) {
            $this->logRepository->addErrorLog('Hyva chip: selectTerm save failed', $e->getMessage());
            $this->rollbackTerm($previousTerm, $days);
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
     * The surcharge is priced off the session term, so every write to that
     * term has to be followed by one of these.
     */
    private function reprice(): \Magento\Quote\Model\Quote
    {
        $quote = $this->checkoutSession->getQuote();
        $quote->collectTotals();
        $this->quoteRepository->save($quote);

        return $quote;
    }

    /**
     * Restore first, reprice second: placement refuses a term that disagrees
     * with the fee's term, but charges one that silently agrees. A failed
     * compensating repricing leaves the abandoned term's fee in the session,
     * so the term goes back to match it.
     */
    private function rollbackTerm(int $previousTerm, int $abandonedTerm): void
    {
        $this->checkoutSession->setTwoSelectedTerm($previousTerm);

        try {
            $this->reprice();
        } catch (\Exception $e) {
            $this->checkoutSession->setTwoSelectedTerm($abandonedTerm);
            $this->logRepository->addErrorLog('Hyva chip: term rollback reprice failed', $e->getMessage());
        }
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
            $this->isEndOfMonth = $this->configRepository->getPaymentTermsType($storeId)
                === PaymentTermsType::END_OF_MONTH;
            $this->surchargeDescription = (string) $this->configRepository->getSurchargeLineDescription($storeId);
            $this->currencyCode = (string) ($quote->getQuoteCurrencyCode() ?: $quote->getStore()->getBaseCurrencyCode());
            // Magento stores locale as `nl_NL`; Intl.NumberFormat expects
            // BCP-47 with hyphens. Translate.
            $this->currencyLocale = (string) str_replace('_', '-', (string) $this->localeResolver->getLocale());

            $sessionTerm = (int) $this->checkoutSession->getTwoSelectedTerm();
            $defaultTerm = (int) $this->configRepository->getDefaultPaymentTerm($storeId);
            $this->selectedTerm = $sessionTerm > 0 ? $sessionTerm : $defaultTerm;

            // Chips visibility is driven by available payment terms alone.
            // Surcharge type only gates per-chip surcharge value display —
            // term selection is a buyer choice independent of fee sharing.
            // A single available term renders one informational (non-clickable)
            // chip, preselected — matching Luma.
            $this->showChip = count($terms) > 1;
            $this->showSingleTerm = count($terms) === 1;
            $this->termSurcharges = (($this->showChip || $this->showSingleTerm) && $type !== SurchargeType::NONE)
                ? $this->computeAllTermSurcharges($quote, $terms)
                : [];
        } catch (\Exception $e) {
            $this->logRepository->addErrorLog('Hyva chip: hydrate failed', $e->getMessage());
            $this->showChip = false;
            $this->showSingleTerm = false;
            $this->isEndOfMonth = false;
            $this->availableTerms = [];
            $this->termSurcharges = [];
            $this->currencyCode = '';
            $this->currencyLocale = '';
        }
    }

    /**
     * A chip's visible-text template, with `%1` standing for the day count.
     */
    public function chipLabelTemplate(): string
    {
        return (string) ($this->isEndOfMonth ? __('EOM+%1') : __('%1 days'));
    }

    /**
     * The one-day form of the above. Standard terms prepend the numeral to the
     * translated unit, which saves a '1 day' catalogue key because the numeral
     * is language-invariant; an end-of-month token needs no separate form.
     */
    public function chipSingularLabel(): string
    {
        return $this->isEndOfMonth
            ? str_replace('%1', '1', (string) __('EOM+%1'))
            : '1 ' . (string) __('day');
    }

    /**
     * The sole-offered-term chip's template, which names the term because that
     * branch renders no heading above it.
     */
    public function singleChipLabelTemplate(): string
    {
        return (string) ($this->isEndOfMonth ? __('Payment Terms EOM+%1') : __('Payment Terms %1 days'));
    }

    /**
     * What `EOM+30` means, spelled out, and empty under standard terms where the
     * visible text already says it. Opens with the visible token: WCAG 2.5.3
     * requires the accessible name to contain the visible text.
     */
    public function chipExplanation(int $days): string
    {
        if (!$this->isEndOfMonth) {
            return '';
        }

        return str_replace(
            '%1',
            (string) $days,
            (string) __('EOM+%1: pay %1 days after the end of the month')
        );
    }

    /**
     * The same sentence stating the surcharge as well, `%2` left for the browser
     * to substitute once the quote lands. An `aria-label` replaces the whole
     * accessible name, so the amount rendered inside the chip is announced
     * nowhere unless the name carries it too.
     */
    public function chipExplanationWithFee(int $days): string
    {
        if (!$this->isEndOfMonth) {
            return '';
        }

        return str_replace(
            '%1',
            (string) $days,
            (string) __('EOM+%1: pay %1 days after the end of the month, plus a %2 surcharge')
        );
    }

    /**
     * Calculator basis matches the read-only Surcharges webapi endpoint:
     * persisted grand_total minus the surcharge segment we just wrote.
     * That excludes our own contribution so chip-to-chip switches don't
     * compound.
     *
     * Delegates net/gross/tax-rate resolution to TermSurchargePreview — the
     * same service the Surcharges/TermSelection webapi endpoints use for
     * Luma's chip — so a surcharge tax class configured via
     * SurchargeTaxCalculator is honoured here too, not just the flat legacy
     * percentage.
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

        $mode = $this->termSurchargePreview->taxDisplay($quote);
        $preview = $this->termSurchargePreview->build(
            $quote,
            $basis,
            $terms,
            $country,
            $currency,
            $storeId,
            'Hyva chip'
        );

        $surcharges = [];
        foreach ($preview as $entry) {
            $surcharges[$entry['days']] = $this->resolveDisplayAmount($mode, $entry['net'], $entry['gross']);
        }

        return $surcharges;
    }

    /**
     * Same excl/incl split as the order-summary segment
     * (Two\Gateway\Service\Order\SurchargeDisplay::pick()), except "both":
     * the summary shows both rows there, but the chip shows one value and
     * that value stays net — a deliberate divergence, not an oversight.
     */
    private function resolveDisplayAmount(string $mode, float $net, float $gross): float
    {
        return $mode === SurchargeDisplay::INCL ? $gross : $net;
    }

    /**
     * Resolve buyer country in precedence order: billing, shipping, store
     * default (`general/country/default`). Returns empty string if none
     * are set — TermSurchargePreview::build() zeros the preview fee for
     * that term rather than guessing a region.
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
