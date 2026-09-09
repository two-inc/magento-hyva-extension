<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\View;

use Magento\Framework\View\Element\Block\ArgumentInterface;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * Hyva's view-model registry rejects anything that is not an ArgumentInterface,
 * and it throws rather than returning null. A template registered as a payment
 * method's icon provider renders inside the payment list, so that throw escapes
 * the list and the buyer is offered NO payment method at all — not ours, not a
 * core one (ABN-527).
 *
 * Static analysis: the registry call site names the class, so the target is
 * knowable without a Magento container.
 */
class ViewModelRegistryTargetTest extends TestCase
{
    private const TEMPLATE_ROOT = __DIR__ . '/../../../view';

    private const BASE_MODULE_NAMESPACE = 'Two\\Gateway\\';

    private const OWN_NAMESPACE = 'Two\\GatewayHyva\\';

    /**
     * @dataProvider registryCallSiteProvider
     */
    public function testRegistryTargetIsUsableAsAViewModel(
        string $template,
        string $target,
        string $case
    ): void {
        // Given a registry call site; when its target is resolved; then it must be a view model.
        $this->assertStringStartsNotWith(
            self::BASE_MODULE_NAMESPACE,
            $target,
            $case . ": {$template} reaches the base module directly; go through CheckoutConfig"
        );

        if (strncmp($target, self::OWN_NAMESPACE, strlen(self::OWN_NAMESPACE)) !== 0) {
            $this->assertTrue(true, $case . ': target is owned by the theme or the framework');
            return;
        }

        $this->assertTrue(
            (new ReflectionClass($target))->implementsInterface(ArgumentInterface::class),
            $case . ": {$target} does not implement ArgumentInterface"
        );
    }

    /**
     * @return array<string, array{string, string, string}>
     */
    public static function registryCallSiteProvider(): array
    {
        $cases = [];

        foreach (self::templates() as $path) {
            $source = (string) file_get_contents($path);
            $template = substr($path, strlen(realpath(self::TEMPLATE_ROOT)) + 1);
            $imports = self::imports($source);

            preg_match_all('/\$viewModels->require\(\s*([A-Za-z_\\\\][A-Za-z0-9_\\\\]*)::class/', $source, $matches);

            foreach (array_unique($matches[1]) as $reference) {
                $target = $imports[ltrim($reference, '\\')] ?? ltrim($reference, '\\');
                $cases["{$template} -> {$target}"] = [$template, $target, "{$template} requires {$target}"];
            }
        }

        return $cases;
    }

    /**
     * @return array<string, string> short name => FQCN
     */
    private static function imports(string $source): array
    {
        preg_match_all('/^use\s+([A-Za-z_\\\\][A-Za-z0-9_\\\\]*)\s*;/m', $source, $matches);

        $imports = [];
        foreach ($matches[1] as $fqcn) {
            $parts = explode('\\', $fqcn);
            $imports[end($parts)] = $fqcn;
        }

        return $imports;
    }

    /**
     * @return list<string>
     */
    private static function templates(): array
    {
        $found = [];
        $walker = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator(realpath(self::TEMPLATE_ROOT), \FilesystemIterator::SKIP_DOTS)
        );

        foreach ($walker as $file) {
            if ($file->isFile() && $file->getExtension() === 'phtml') {
                $found[] = $file->getPathname();
            }
        }

        sort($found);

        return $found;
    }
}
