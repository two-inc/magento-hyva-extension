<?php

declare(strict_types=1);

// Minimal stub of Magento\Framework\Component\ComponentRegistrar — the only
// framework dependency of Two\GatewayHyva\Model\Provenance. The real class is
// a static registry; the tests only need the MODULE constant and an
// instance-level getPath() they can drive, so the stub keeps a per-instance
// map instead of the framework's static one.

namespace Magento\Framework\Component {
    if (!class_exists(ComponentRegistrar::class, false)) {
        class ComponentRegistrar
        {
            public const MODULE = 'module';

            /** @var array<string, array<string, string>> */
            private array $paths = [];

            public function setPathForTest(string $type, string $name, string $path): void
            {
                $this->paths[$type][$name] = $path;
            }

            public function getPath(string $type, string $name): ?string
            {
                return $this->paths[$type][$name] ?? null;
            }
        }
    }
}
