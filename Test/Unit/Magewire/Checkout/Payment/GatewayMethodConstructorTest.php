<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Magewire\Checkout\Payment;

use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use Two\GatewayHyva\Magewire\Checkout\Payment\GatewayMethod;

/**
 * A brand overlay subclasses this component and forwards the constructor
 * positionally up to and including the method code, so the method code has to
 * stay at the position it holds. A dependency inserted ahead of it lands in the
 * wrong parameter and the payment tile stops constructing on every branded store
 * view — which no CI leg in this repository would catch. Appending after it is
 * safe, which is why the assertion pins a position rather than the end.
 */
class GatewayMethodConstructorTest extends TestCase
{
    public function testTheMethodCodeKeepsItsConstructorPosition(): void
    {
        $parameters = (new ReflectionMethod(GatewayMethod::class, '__construct'))->getParameters();

        $this->assertSame('methodCode', $parameters[7]->getName());
        $this->assertTrue($parameters[7]->isDefaultValueAvailable());
    }
}
