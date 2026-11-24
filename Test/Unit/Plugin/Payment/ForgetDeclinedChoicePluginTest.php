<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Plugin\Payment;

use Hyva\Checkout\Magewire\Checkout\Payment\MethodList;
use Magento\Checkout\Model\Session;
use Magento\Framework\App\RequestInterface;
use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Model\Quote;
use PHPUnit\Framework\TestCase;
use Two\GatewayHyva\Plugin\Payment\ForgetDeclinedChoicePlugin;
use Two\GatewayHyva\ViewModel\BrandedHyvaViewModelInterface;

/**
 * TWO-27396: on the decline return's landing, this brand's method is taken off
 * the quote and out of the payment list's selection, once; any other method,
 * and any request without the marker, is left alone.
 */
class ForgetDeclinedChoicePluginTest extends TestCase
{
    private const BRAND_METHOD = 'examplebrand_payment';

    /**
     * @dataProvider landingProvider
     */
    public function testLandingForgetsOnlyThisMethod(
        ?string $marker,
        ?string $quoteMethod,
        ?string $listMethod,
        ?string $expectedQuoteMethod,
        ?string $expectedListMethod,
        int $expectedSaves,
        string $because
    ): void {
        $quote = new Quote();
        $quote->getPayment()->setMethod($quoteMethod);
        $session = new Session();
        $session->setQuote($quote);
        $repository = $this->recordingRepository();
        $list = new MethodList();
        $list->method = $listMethod;

        $plugin = new ForgetDeclinedChoicePlugin(
            $this->request($marker),
            $session,
            $repository,
            $this->brandedViewModel()
        );
        $plugin->afterBoot($list);

        $this->assertSame($expectedQuoteMethod, $session->getQuote()->getPayment()->getMethod(), "$because: quote");
        $this->assertSame($expectedListMethod, $list->method, "$because: list selection");
        $this->assertSame($expectedSaves, $repository->saves, "$because: quote saves");
    }

    /** @return array<int, array{?string, ?string, ?string, ?string, ?string, int, string}> */
    public static function landingProvider(): array
    {
        $brand = self::BRAND_METHOD;

        return [
            // marker, quote method, list method, quote after, list after, saves, description
            ['1', $brand, $brand, null, null, 1, 'the landing forgets this method on the quote and in the list'],
            ['1', null, $brand, null, null, 0, 'a list selection the quote does not hold is still cleared'],
            ['1', 'checkmo', 'checkmo', 'checkmo', 'checkmo', 0, 'another method is left alone'],
            ['1', 'two_payment', 'two_payment', 'two_payment', 'two_payment', 0, 'only this brand\'s code counts'],
            ['1', null, null, null, null, 0, 'nothing selected: nothing to do'],
            [null, $brand, $brand, $brand, $brand, 0, 'no marker (a reload, a Magewire round trip): kept'],
            ['0', $brand, $brand, $brand, $brand, 0, 'another value is not the marker'],
        ];
    }

    private function request(?string $marker): RequestInterface
    {
        return new class ($marker) implements RequestInterface {
            /** @var ?string */
            private $marker;

            public function __construct(?string $marker)
            {
                $this->marker = $marker;
            }

            public function getParam($key, $default = null)
            {
                return $key === 'two_declined' ? $this->marker : $default;
            }
        };
    }

    /** @return CartRepositoryInterface&object{saves: int} */
    private function recordingRepository(): CartRepositoryInterface
    {
        return new class implements CartRepositoryInterface {
            public int $saves = 0;

            public function save(Quote $quote): void
            {
                $this->saves++;
            }
        };
    }

    private function brandedViewModel(): BrandedHyvaViewModelInterface
    {
        $viewModel = $this->createMock(BrandedHyvaViewModelInterface::class);
        $viewModel->method('getMethodCode')->willReturn(self::BRAND_METHOD);

        return $viewModel;
    }
}
