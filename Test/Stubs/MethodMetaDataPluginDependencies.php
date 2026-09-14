<?php

declare(strict_types=1);

// Minimal stubs of the Hyva and Magento classes MethodMetaDataPlugin plugs
// into and composes. See Test/bootstrap.php for the stubbing convention.

namespace Hyva\Checkout\Model {
    if (!class_exists(MethodMetaData::class, false)) {
        class MethodMetaData
        {
            /** @var array<string, mixed> */
            private $data = [];

            /** @param array<string, mixed> $data */
            public function __construct(array $data = [])
            {
                $this->data = $data;
            }

            /** @return mixed */
            public function getData(string $key)
            {
                return $this->data[$key] ?? null;
            }
        }
    }
}

namespace Hyva\Checkout\Model\ConfigData\HyvaThemes {
    if (!class_exists(SystemConfigPayment::class, false)) {
        class SystemConfigPayment
        {
            /** @var bool */
            public $displayMethodIcons = true;

            public function canDisplayMethodIcons(): bool
            {
                return $this->displayMethodIcons;
            }
        }
    }
}

namespace Magento\Framework\View\Element {
    if (!class_exists(Template::class, false)) {
        class Template
        {
            /** @var string */
            public $html = '';

            public function setTemplate(string $template): self
            {
                return $this;
            }

            public function toHtml(): string
            {
                return $this->html;
            }
        }
    }
}

namespace Magento\Framework\View {
    use Magento\Framework\View\Element\Template;

    if (!class_exists(Layout::class, false)) {
        class Layout
        {
            /** @var string */
            public $blockHtml = '';

            public function createBlock(string $type): Template
            {
                $block = new Template();
                $block->html = $this->blockHtml;

                return $block;
            }
        }
    }
}
