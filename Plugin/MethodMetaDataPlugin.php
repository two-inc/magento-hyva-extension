<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace ABN\GatewayHyva\Plugin;

use Hyva\Checkout\Model\ConfigData\HyvaThemes\SystemConfigPayment;
use Hyva\Checkout\Model\MethodMetaData;
use Magento\Framework\View\Element\Template as TemplateBlock;
use Magento\Framework\View\Layout;
use Magento\Store\Model\StoreManagerInterface;

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

    public function __construct(
        Layout                   $layout,
        StoreManagerInterface    $storeManager,
        SystemConfigPayment      $systemConfigPayment
    ) {
        $this->layout = $layout;
        $this->storeManager = $storeManager;
        $this->systemConfigPayment = $systemConfigPayment;
    }

    /**
     * Added tooltip by additional icons provider field
     *
     * @param MethodMetaData $subject
     * @param bool $result
     * @return bool
     */
    public function afterCanRenderIcon(MethodMetaData $subject, bool $result): bool
    {
        if ($subject->getData('additional_icons_provider') || $subject->getData('additional_icon_provider')) {
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
    public function afterRenderIcon(MethodMetaData $subject, string $result): string
    {
        $iconsProvider = $subject->getData('additional_icons_provider');
        $storeId = (int)$this->storeManager->getStore()->getId();
        $iconProvider = $subject->getData('additional_icon_provider');
        if ($iconProvider) {
                $block = $this->layout->createBlock(TemplateBlock::class);
                $blockHtml = $block->setTemplate($iconProvider['template'])->toHtml();
                $result = "<div class='flex tooltip-icon w-full items-center justify-between'><div class='tooltip-pay inline-block py-2 mr-4'>".$blockHtml."</div><div class='icon-pay inline-block'>".$result."</div></div>";
        }

        return $result;
    }
}
