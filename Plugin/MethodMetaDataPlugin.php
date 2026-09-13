<?php

/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Plugin;

use Hyva\Checkout\Model\ConfigData\HyvaThemes\SystemConfigPayment;
use Hyva\Checkout\Model\MethodMetaData;
use Magento\Framework\View\Element\Template as TemplateBlock;
use Magento\Framework\View\Layout;
use Magento\Store\Model\StoreManagerInterface;
use Two\Gateway\Model\Ui\CheckoutTileCopy;

class MethodMetaDataPlugin
{
    /**
     * @var Layout
     */
    private $layout;

    /**
     * @var StoreManagerInterface
     */
    private $storeManager;

    /**
     * @var SystemConfigPayment
     */
    private $systemConfigPayment;

    /**
     * @var CheckoutTileCopy
     */
    private $checkoutTileCopy;

    public function __construct(
        Layout $layout,
        StoreManagerInterface $storeManager,
        SystemConfigPayment $systemConfigPayment,
        CheckoutTileCopy $checkoutTileCopy,
    ) {
        $this->layout = $layout;
        $this->storeManager = $storeManager;
        $this->systemConfigPayment = $systemConfigPayment;
        $this->checkoutTileCopy = $checkoutTileCopy;
    }

    /**
     * Added tooltip by additional icons provider field
     *
     * @param MethodMetaData $subject
     * @param bool $result
     * @return bool
     */
    public function afterCanRenderIcon(
        MethodMetaData $subject,
        bool $result,
    ): bool {
        if ($subject->getData("additional_icon_provider")) {
            // The method-icon toggle gates the brand logo, not the explainer (ABN-554).
            return $this->checkoutTileCopy->isAboutLinkVisible()
                || $this->systemConfigPayment->canDisplayMethodIcons();
        }
        if ($subject->getData("additional_icons_provider")) {
            return $this->systemConfigPayment->canDisplayMethodIcons();
        }
        return $result;
    }

    /**
     * Added tooltip
     *
     * @param MethodMetaData $subject
     * @param string $result
     * @return string
     * @throws \Magento\Framework\Exception\NoSuchEntityException
     */
    public function afterRenderIcon(
        MethodMetaData $subject,
        string $result,
    ): string {
        $iconProvider = $subject->getData("additional_icon_provider");
        if ($iconProvider) {
            if (!$this->systemConfigPayment->canDisplayMethodIcons()) {
                $result = "";
            }
            $block = $this->layout->createBlock(TemplateBlock::class);
            $blockHtml = $block
                ->setTemplate($iconProvider["template"])
                ->toHtml();
            // Either half can be withheld, and an empty wrapper still occupies
            // its padding and its share of the row.
            $result =
                "<div class='flex tooltip-icon w-full items-center justify-between'>" .
                ($blockHtml === "" ? "" : "<div class='tooltip-pay inline-block py-2 mr-4'>" . $blockHtml . "</div>") .
                ($result === "" ? "" : "<div class='icon-pay inline-block'>" . $result . "</div>") .
                "</div>";
        }

        return $result;
    }
}
