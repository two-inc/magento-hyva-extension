<?php

declare(strict_types=1);

// Minimal stubs of the Magento admin-block chain that
// Two\GatewayHyva\Block\Adminhtml\System\Config\Field\Version extends and
// type-hints. Only enough surface to load the class and exercise its pure
// string-composition logic — the template rendering itself is Magento's job
// and is not under test here.

namespace Magento\Framework\Data\Form\Element {
    if (!class_exists(AbstractElement::class, false)) {
        class AbstractElement
        {
        }
    }
}

namespace Magento\Framework\App\Config {
    if (!interface_exists(ScopeConfigInterface::class, false)) {
        interface ScopeConfigInterface
        {
            /**
             * @param string $path
             * @param string $scope
             * @param null|int|string $scopeCode
             * @return mixed
             */
            public function getValue($path, $scope = 'default', $scopeCode = null);
        }
    }
}

namespace Magento\Backend\Block\Template {
    if (!class_exists(Context::class, false)) {
        class Context
        {
        }
    }
}

namespace Magento\Config\Block\System\Config\Form {
    use Magento\Backend\Block\Template\Context;

    if (!class_exists(Field::class, false)) {
        class Field
        {
            /**
             * @param array<mixed> $data
             */
            public function __construct(?Context $context = null, array $data = [])
            {
            }
        }
    }
}
