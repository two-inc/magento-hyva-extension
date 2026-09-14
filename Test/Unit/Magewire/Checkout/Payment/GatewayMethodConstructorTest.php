<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Magewire\Checkout\Payment;

use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use Two\GatewayHyva\Magewire\Checkout\Payment\GatewayMethod;

/**
 * Subclasses outside this repository forward this constructor positionally, so
 * the method code has to keep the position it holds — a dependency inserted
 * ahead of it lands in the wrong parameter and the payment tile stops
 * constructing. Appending after it is safe, which is why the assertion pins a
 * position rather than the end.
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
