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
             * Declared by core's AbstractBlock, not by Two — a subclass that
             * reads them outside the framework would otherwise create dynamic
             * properties.
             *
             * @var mixed
             */
            protected $_request;

            /** @var mixed */
            protected $_storeManager;

            /**
             * @param array<mixed> $data
             */
            public function __construct(?Context $context = null, array $data = [])
            {
            }

            public function getRequest()
            {
                return $this->_request;
            }
        }
    }
}

namespace Magento\Framework\Exception {
    if (!class_exists(NoSuchEntityException::class, false)) {
        class NoSuchEntityException extends \Exception
        {
        }
    }
}

namespace Magento\Framework\App {
    if (!interface_exists(RequestInterface::class, false)) {
        interface RequestInterface
        {
            /**
             * @param string $key
             * @param mixed $default
             * @return mixed
             */
            public function getParam($key, $default = null);
        }
    }
}

namespace Magento\Store\Model {
    if (!interface_exists(StoreManagerInterface::class, false)) {
        interface StoreManagerInterface
        {
            /**
             * @param mixed $storeId
             * @return mixed
             */
            public function getStore($storeId = null);

            /**
             * @param mixed $websiteId
             * @return mixed
             */
            public function getWebsite($websiteId = null);
        }
    }
}
