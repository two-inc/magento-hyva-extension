<?php

declare(strict_types=1);

// Stub of Magento's translation primitives: \Magento\Framework\Phrase plus the
// global __() factory. Placeholder handling mirrors
// Magento\Framework\Phrase\Renderer\Placeholder — %1 / %2 are rewritten to
// %1$s / %2$s and then vsprintf'd — so tests exercise the real substitution
// semantics without booting the framework. No translation is performed, which
// matches an unmapped locale falling back to the source string.

namespace Magento\Framework {
    if (!class_exists(Phrase::class, false)) {
        class Phrase
        {
            /** @var string */
            private $text;

            /** @var array<int, mixed> */
            private $arguments;

            /**
             * @param array<int, mixed> $arguments
             */
            public function __construct(string $text, array $arguments = [])
            {
                $this->text = $text;
                $this->arguments = $arguments;
            }

            public function __toString(): string
            {
                if ($this->arguments === []) {
                    return $this->text;
                }

                $template = preg_replace('/%(\d+)/', '%$1$s', $this->text);

                return vsprintf($template, array_map('strval', $this->arguments));
            }
        }
    }
}

namespace {
    if (!function_exists('__')) {
        /**
         * @param mixed ...$args
         */
        function __(string $text, ...$args): \Magento\Framework\Phrase
        {
            return new \Magento\Framework\Phrase($text, $args);
        }
    }
}
