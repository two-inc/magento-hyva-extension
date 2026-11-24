<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Plugin\Payment;

use Hyva\Checkout\Magewire\Checkout\Payment\MethodList;
use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Framework\App\RequestInterface;
use Magento\Quote\Api\CartRepositoryInterface;
use Two\GatewayHyva\ViewModel\BrandedHyvaViewModelInterface;

/**
 * TWO-27396: a buyer the payment method did not approve lands back on the
 * checkout to choose another method, and this method must not be chosen for
 * them.
 *
 * The base module's decline return restores the basket with no payment method
 * and marks that one redirect with its documented `two_declined=1` checkout
 * marker. Hyvä Checkout can still pick a method on that landing (its
 * auto-select on checkout init, for example), and its payment list takes the
 * selection from the quote when it boots. So on the landing request only,
 * after the list has booted, this method is taken off the quote and out of the
 * list's selection. It stays offered, and any other method is left alone.
 *
 * Only the landing request carries the marker: Magewire's own round trips do
 * not, and the landing template removes it from the address bar, so a reload
 * keeps whatever the buyer has chosen since.
 */
class ForgetDeclinedChoicePlugin
{
    /**
     * The base module's decline-return marker, parameter and value.
     */
    public const MARKER_PARAM = 'two_declined';
    public const MARKER_VALUE = '1';

    /** @var RequestInterface */
    private $request;

    /** @var CheckoutSession */
    private $checkoutSession;

    /** @var CartRepositoryInterface */
    private $cartRepository;

    /** @var BrandedHyvaViewModelInterface */
    private $brandedViewModel;

    public function __construct(
        RequestInterface $request,
        CheckoutSession $checkoutSession,
        CartRepositoryInterface $cartRepository,
        BrandedHyvaViewModelInterface $brandedViewModel
    ) {
        $this->request = $request;
        $this->checkoutSession = $checkoutSession;
        $this->cartRepository = $cartRepository;
        $this->brandedViewModel = $brandedViewModel;
    }

    /**
     * @param MethodList $subject
     * @param mixed $result
     * @return mixed
     */
    public function afterBoot(MethodList $subject, $result = null)
    {
        if ((string)$this->request->getParam(self::MARKER_PARAM) !== self::MARKER_VALUE) {
            return $result;
        }
        $methodCode = $this->brandedViewModel->getMethodCode();
        $quote = $this->checkoutSession->getQuote();
        if ((string)$quote->getPayment()->getMethod() === $methodCode) {
            $quote->removePayment();
            $this->cartRepository->save($quote);
        }
        if (property_exists($subject, 'method') && $subject->method === $methodCode) {
            $subject->method = null;
        }
        return $result;
    }
}
