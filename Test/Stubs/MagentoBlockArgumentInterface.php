<?php

declare(strict_types=1);

// Stub of Magento's view-model marker interface. It declares no methods in the
// framework either, so this is faithful, not a simplification — it exists only
// so view-model classes can be loaded without booting Magento.

namespace Magento\Framework\View\Element\Block {
    if (!interface_exists(ArgumentInterface::class, false)) {
        interface ArgumentInterface
        {
        }
    }
}
