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

/**
 * TwoGateWayMethod - Hyvä Checkout
 */
class TwoGateWayMethod extends Component
{
    public array $quoteInformations = [];

    public string $countryCode = "";

    protected $loader = true;

    public function __construct(
        private Session $checkoutSession,
        private CartRepositoryInterface $quoteRepository,
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
}
