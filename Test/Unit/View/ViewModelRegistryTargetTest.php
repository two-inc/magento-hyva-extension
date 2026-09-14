<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\View;

use Magento\Framework\View\Element\Block\ArgumentInterface;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * Hyva's view-model registry throws on a target that is not an
 * ArgumentInterface. A template rendered inside the payment list lets that
 * throw escape the list, so the buyer is offered no payment method at all —
 * not ours, not a core one (ABN-527).
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

        // A theme- or framework-owned target is not loadable in this suite.
        if (strncmp($target, self::OWN_NAMESPACE, strlen(self::OWN_NAMESPACE)) !== 0) {
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
        preg_match_all(
            '/^use\s+([A-Za-z_\\\\][A-Za-z0-9_\\\\]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/mi',
            $source,
            $matches
        );

        $imports = [];
        foreach ($matches[1] as $index => $fqcn) {
            $parts = explode('\\', $fqcn);
            $imports[$matches[2][$index] ?: end($parts)] = $fqcn;
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
