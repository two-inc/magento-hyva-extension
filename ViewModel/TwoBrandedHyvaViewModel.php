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

    public function getPaymentTermsMessage(string $termsLink, string $brandFullName): Phrase
    {
        // Mirror the Luma ConfigProvider's T&C-acceptance pattern so
        // Two-brand renders the same source phrase on both Luma and
        // Hyva checkouts — no Luma↔Hyva copy divergence. %1 is the
        // translated "payment terms" phrase wrapped in an anchor;
        // %2 is the brand's legal full name from brand.xml.
        return __(
            'I accept the %1 and authorize %2 to process my data automatically.',
            sprintf(
                '<a class="text-blue-600" href="%s" target="_blank">%s</a>',
                $termsLink,
                __('payment terms'),
            ),
            $brandFullName,
        );
    }
}
