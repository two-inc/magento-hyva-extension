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
 * TWO-27396: on the decline return's landing, this brand's method is cleared
 * from the quote's stored payment and from the payment list's selection, once;
 * any other method, and any request without the marker, is left alone.
 *
 * The repository double stores the method the saved quote's payment carries,
 * and each boot loads the quote from that store, as a new request does. So a
 * clear that never reaches the stored payment shows up as the method coming
 * back on the next boot.
 */
class ForgetDeclinedChoicePluginTest extends TestCase
{
    private const BRAND_METHOD = 'examplebrand_payment';

    /**
     * @dataProvider landingProvider
     */
    public function testLandingForgetsOnlyThisMethod(
        ?string $marker,
        ?string $storedMethod,
        ?string $listMethod,
        ?string $expectedStored,
        ?string $expectedListMethod,
        string $because
    ): void {
        $repository = $this->storingRepository($storedMethod);
        $list = new MethodList();
        $list->method = $listMethod;

        $this->boot($repository, $list, $marker);

        $this->assertSame($expectedStored, $repository->stored, "$because: stored quote payment");
        $this->assertSame($expectedListMethod, $list->method, "$because: list selection");
    }

    /** @return array<int, array{?string, ?string, ?string, ?string, ?string, string}> */
    public static function landingProvider(): array
    {
        $brand = self::BRAND_METHOD;

        return [
            // marker, stored method, list method, stored after, list after, description
            ['1', $brand, $brand, null, null, 'the landing clears this method on the stored payment and in the list'],
            ['1', null, $brand, null, null, 'a list selection the quote does not hold is still cleared'],
            ['1', 'checkmo', 'checkmo', 'checkmo', 'checkmo', 'another method is left alone'],
            ['1', 'two_payment', 'two_payment', 'two_payment', 'two_payment', 'only this brand\'s code counts'],
            ['1', null, null, null, null, 'nothing selected: nothing to do'],
            [null, $brand, $brand, $brand, $brand, 'no marker (a reload, a Magewire round trip): kept'],
            ['0', $brand, $brand, $brand, $brand, 'another value is not the marker'],
        ];
    }

    public function testTheNextBootWithoutTheMarkerDoesNotBringTheMethodBack(): void
    {
        $repository = $this->storingRepository(self::BRAND_METHOD);
        $landing = new MethodList();
        $landing->method = self::BRAND_METHOD;
        $this->boot($repository, $landing, '1');

        // The next request: Hyvä's list boots from the stored quote, as its own
        // boot does, and the marker is gone.
        $reboot = new MethodList();
        $reboot->method = $repository->stored;
        $this->boot($repository, $reboot, null);

        $this->assertNull($repository->stored, 'the stored payment keeps no method');
        $this->assertNull($reboot->method, 'the next boot selects nothing');
    }

    /**
     * One request: the quote loaded from the store, then the plugin after the
     * list's boot.
     *
     * @param CartRepositoryInterface&object{stored: ?string} $repository
     */
    private function boot(CartRepositoryInterface $repository, MethodList $list, ?string $marker): void
    {
        $quote = new Quote();
        $quote->getPayment()->setMethod($repository->stored);
        $session = new Session();
        $session->setQuote($quote);

        (new ForgetDeclinedChoicePlugin(
            $this->request($marker),
            $session,
            $repository,
            $this->brandedViewModel()
        ))->afterBoot($list);
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

    /** @return CartRepositoryInterface&object{stored: ?string} */
    private function storingRepository(?string $stored): CartRepositoryInterface
    {
        return new class ($stored) implements CartRepositoryInterface {
            /** @var ?string the method on the stored quote payment */
            public $stored;

            public function __construct(?string $stored)
            {
                $this->stored = $stored;
            }

            public function save(Quote $quote): void
            {
                $this->stored = $quote->getPayment()->getMethod();
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
