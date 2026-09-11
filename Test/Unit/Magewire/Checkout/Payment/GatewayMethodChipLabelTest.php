<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Magewire\Checkout\Payment;

use PHPUnit\Framework\TestCase;
use Two\GatewayHyva\Magewire\Checkout\Payment\GatewayMethod;

/**
 * ABN-554. An end-of-month term falls due that many days after the end of the
 * month, so a chip reading "30 days" on a shop configured that way states the
 * wrong due date. These pin what the chip says and what names it.
 */
class GatewayMethodChipLabelTest extends TestCase
{
    private function component(bool $isEndOfMonth): GatewayMethod
    {
        $instance = (new \ReflectionClass(GatewayMethod::class))->newInstanceWithoutConstructor();
        $instance->isEndOfMonth = $isEndOfMonth;

        return $instance;
    }

    /**
     * @return array<int, array{0: bool, 1: string, 2: string, 3: string, 4: string}>
     */
    public static function labelProvider(): array
    {
        return [
            [false, '%1 days', '1 day', 'Payment Terms %1 days', 'a standard term states the days from invoice'],
            [true, 'EOM+%1', 'EOM+1', 'Payment Terms EOM+%1', 'an end-of-month term names the month end'],
        ];
    }

    /**
     * @dataProvider labelProvider
     */
    public function testTheVisibleText(
        bool $isEndOfMonth,
        string $plural,
        string $singular,
        string $single,
        string $because
    ): void {
        $component = $this->component($isEndOfMonth);

        $this->assertSame($plural, $component->chipLabelTemplate(), $because);
        $this->assertSame($singular, $component->chipSingularLabel(), $because);
        $this->assertSame($single, $component->singleChipLabelTemplate(), $because);
    }

    /**
     * @return array<int, array{0: bool, 1: int, 2: string, 3: string}>
     */
    public static function explanationProvider(): array
    {
        return [
            [false, 30, '', 'a standard chip needs no name of its own'],
            [true, 30, 'EOM+30: pay 30 days after the end of the month', 'an end-of-month chip is spelled out'],
            [true, 1, 'EOM+1: pay 1 days after the end of the month', 'so is the shortest one'],
            [true, 120, 'EOM+120: pay 120 days after the end of the month', 'and a three-digit one'],
        ];
    }

    /**
     * @dataProvider explanationProvider
     */
    public function testTheAccessibleName(bool $isEndOfMonth, int $days, string $expected, string $because): void
    {
        $this->assertSame($expected, $this->component($isEndOfMonth)->chipExplanation($days), $because);
    }

    /**
     * @dataProvider explanationProvider
     */
    public function testTheAccessibleNameContainsTheVisibleText(
        bool $isEndOfMonth,
        int $days,
        string $expected,
        string $because
    ): void {
        if (!$isEndOfMonth) {
            $this->assertSame('', $expected, $because);
            return;
        }

        $component = $this->component($isEndOfMonth);
        $visible = str_replace('%1', (string) $days, $component->chipLabelTemplate());

        // WCAG 2.5.3 Label in Name.
        $this->assertStringContainsString($visible, $component->chipExplanation($days), $because);
    }
    /**
     * The accessors above are only as good as the flag they read, and nothing
     * else in this suite would notice hydration never setting it.
     */
    public function testHydrationReadsTheStoredTermType(): void
    {
        $source = (string) file_get_contents(
            __DIR__ . '/../../../../../Magewire/Checkout/Payment/GatewayMethod.php'
        );
        $start = strpos($source, 'private function hydrateChipState');
        $this->assertNotFalse($start, 'hydrateChipState must exist');
        $body = substr($source, $start, strpos($source, "\n    /**", $start) - $start);

        $this->assertStringContainsString('->getPaymentTermsType(', $body);
        $this->assertStringContainsString('$this->isEndOfMonth =', $body);
    }
}
