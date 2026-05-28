<?php

declare(strict_types=1);

namespace Two\GatewayHyva\ViewModel;

use Magento\Framework\Phrase;

final class TwoBrandedHyvaViewModel implements BrandedHyvaViewModelInterface
{
    public function getAlpineFnPrefix(): string
    {
        return 'two';
    }

    public function getFormId(): string
    {
        return 'two_gateway_form';
    }

    public function getMethodCode(): string
    {
        return 'two_payment';
    }

    public function getMagewireBlockName(): string
    {
        return 'checkout.payment.method.two-payment-method';
    }

    public function getPaymentTermsMessage(string $termsLink, string $brandTermsName): Phrase
    {
        return __(
            "By checking this box, I confirm that I have read and agree to %1.",
            sprintf(
                '<a class="text-blue-600" href="%s" target="_blank">%s</a>',
                $termsLink,
                $brandTermsName,
            ),
        );
    }
}
