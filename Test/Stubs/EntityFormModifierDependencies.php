<?php

declare(strict_types=1);

// Minimal stubs of the Hyvä form classes CompanySortOrderModifier works on.
// See Test/bootstrap.php for the stubbing convention.

namespace Magento\Quote\Api\Data {
    if (!interface_exists(AddressInterface::class, false)) {
        interface AddressInterface
        {
            public const KEY_COUNTRY_ID = 'country_id';
            public const KEY_STREET = 'street';
            public const KEY_COMPANY = 'company';
            public const KEY_TELEPHONE = 'telephone';
            public const KEY_POSTCODE = 'postcode';
            public const KEY_CITY = 'city';
            public const KEY_REGION = 'region';
        }
    }
}

namespace Hyva\Checkout\Model\Form {
    if (!interface_exists(EntityFormElementInterface::class, false)) {
        interface EntityFormElementInterface
        {
            public const POSITION = 'position';
        }
    }

    if (!class_exists(AbstractEntityFormModifier::class, false)) {
        abstract class AbstractEntityFormModifier
        {
            abstract public function apply(AbstractEntityForm $form): AbstractEntityForm;
        }
    }

    if (!class_exists(EntityFormElementCollection::class, false)) {
        class EntityFormElementCollection
        {
            /** @var int */
            public $sorts = 0;

            public function sort(): self
            {
                $this->sorts++;
                return $this;
            }
        }
    }

    if (!class_exists(AbstractEntityFormContext::class, false)) {
        class AbstractEntityFormContext
        {
            /** @var EntityFormElementCollection */
            public $elements;

            public function __construct()
            {
                $this->elements = new EntityFormElementCollection();
            }

            public function elements(): EntityFormElementCollection
            {
                return $this->elements;
            }
        }
    }

    if (!class_exists(AbstractEntityForm::class, false)) {
        class AbstractEntityForm
        {
            /** @var array<string, EntityField\AbstractEntityField> */
            public $fields = [];

            /** @var array<string, array<string, callable>> */
            public $listeners = [];

            /** @var AbstractEntityFormContext */
            private $context;

            /** @param array<string, int> $positions */
            public function __construct(array $positions)
            {
                foreach ($positions as $name => $position) {
                    $this->fields[$name] = new EntityField\AbstractEntityField($position);
                }
                $this->context = new AbstractEntityFormContext();
            }

            public function getField(string $name): ?EntityField\AbstractEntityField
            {
                return $this->fields[$name] ?? null;
            }

            public function registerModificationListener(string $name, string $event, callable $modifier): self
            {
                $this->listeners[$event][$name] = $modifier;
                return $this;
            }

            public function dispatchModificationHook(string $event): void
            {
                foreach ($this->listeners[$event] ?? [] as $listener) {
                    $listener($this);
                }
            }

            public function context(): AbstractEntityFormContext
            {
                return $this->context;
            }
        }
    }
}

namespace Hyva\Checkout\Model\Form\EntityField {
    if (!class_exists(AbstractEntityField::class, false)) {
        class AbstractEntityField
        {
            /** @var int */
            private $position;

            public function __construct(int $position)
            {
                $this->position = $position;
            }

            /** @param mixed $value */
            public function setData(string $key, $value): self
            {
                $this->position = $value;
                return $this;
            }

            public function getSortOrder(): int
            {
                return $this->position;
            }
        }
    }
}
