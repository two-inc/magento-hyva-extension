<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Service\Checkout;

use PHPUnit\Framework\TestCase;
use Two\GatewayHyva\Service\Checkout\UnclaimedTotalSegments;

/**
 * @internal fake total, exposing only what UnclaimedTotalSegments::filter() reads
 */
final class FakeTotal
{
    public function __construct(private float $value, private string $title)
    {
    }

    public function getValue(): float
    {
        return $this->value;
    }

    public function getTitle(): string
    {
        return $this->title;
    }
}

class UnclaimedTotalSegmentsTest extends TestCase
{
    /**
     * @return array<string, array{0: array<string, FakeTotal>, 1: string[], 2: array<int, array{code: string, title: string, value: float}>, 3: string}>
     */
    public static function totalsProvider(): array
    {
        $amasty = ['amasty_extrafee' => new FakeTotal(5.99, 'Amasty Extra Fee')];
        $core = [
            'subtotal' => new FakeTotal(34.0, 'Subtotal'),
            'tax' => new FakeTotal(1.2, 'Tax'),
            'grand_total' => new FakeTotal(41.19, 'Grand Total'),
        ];

        return [
            'unregistered extension fee is shown' => [
                array_merge($core, $amasty),
                [],
                [['code' => 'amasty_extrafee', 'title' => 'Amasty Extra Fee', 'value' => 5.99]],
                'core codes stay excluded, the unclaimed fee passes through',
            ],
            'core codes never duplicate' => [
                $core,
                [],
                [],
                "subtotal/tax/grand_total are Hyva's own dedicated blocks, never repeated here",
            ],
            'a sibling-claimed code is excluded' => [
                array_merge($core, $amasty, ['two_surcharge' => new FakeTotal(3.0, 'Payment terms fee')]),
                ['two_surcharge'],
                [['code' => 'amasty_extrafee', 'title' => 'Amasty Extra Fee', 'value' => 5.99]],
                'two_surcharge already has its own registered block, so it is excluded even though it is not a core code',
            ],
            'a zero-value total is not shown' => [
                array_merge($core, ['amasty_extrafee' => new FakeTotal(0.0, 'Amasty Extra Fee')]),
                [],
                [],
                'nothing to reconcile if the fee resolved to zero on this quote',
            ],
            'a negative-value total is still shown' => [
                array_merge($core, ['amasty_extrafee' => new FakeTotal(-5.99, 'Amasty Extra Fee')]),
                [],
                [['code' => 'amasty_extrafee', 'title' => 'Amasty Extra Fee', 'value' => -5.99]],
                'a credit-like total is a real line Luma would still render, unlike an exact zero',
            ],
        ];
    }

    /**
     * @dataProvider totalsProvider
     */
    public function testFilter(array $totals, array $claimedSiblingCodes, array $expected, string $because): void
    {
        $this->assertSame($expected, UnclaimedTotalSegments::filter($totals, $claimedSiblingCodes), $because);
    }
}
