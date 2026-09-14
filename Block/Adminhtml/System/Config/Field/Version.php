<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Block\Adminhtml\System\Config\Field;

use Magento\Backend\Block\Template\Context;
use Magento\Config\Block\System\Config\Form\Field;
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\Data\Form\Element\AbstractElement;
use Two\GatewayHyva\Model\Provenance;

/**
 * Render Hyva extension version field html element in Stores Configuration
 *
 * Displays `<version> (<sha7>)` so a support conversation can pin down the
 * exact commit a shop is running, not just the release it claims to be
 * (TWO-25205). Every provenance signal is optional: with none resolvable the
 * field degrades to the bare version string it rendered before.
 */
class Version extends Field
{
    /**
     * Module this block reports on. The commit is repo-wide, so this is only
     * used to find the deployed module directory.
     */
    private const MODULE_NAME = 'Two_GatewayHyva';

    /**
     * @var string
     */
    protected $_template = "Two_GatewayHyva::system/config/field/version.phtml";

    /**
     * @var ScopeConfigInterface
     */
    private $scopeConfig;

    /**
     * Commit-SHA resolution. Protected so a constructor-free test double can
     * supply it.
     *
     * @var Provenance
     */
    protected $provenance;

    /**
     * Version constructor.
     *
     * @param ScopeConfigInterface $scopeConfig
     * @param Context $context
     * @param Provenance $provenance
     * @param array $data
     */
    public function __construct(
        ScopeConfigInterface $scopeConfig,
        Context $context,
        Provenance $provenance,
        array $data = [],
    ) {
        $this->scopeConfig = $scopeConfig;
        $this->provenance = $provenance;
        parent::__construct($context, $data);
    }

    /**
     * Get extension version
     *
     * @return string
     */
    public function getVersion(): string
    {
        return (string) $this->scopeConfig->getValue(
            "two_hyva/general/version",
        );
    }

    /**
     * 7-char commit SHA of the deployed extension, or '' when no provenance
     * signal is present. Never throws.
     *
     * @return string
     */
    public function getCommit(): string
    {
        return $this->provenance->commitForModule(self::MODULE_NAME);
    }

    /**
     * The rendered field text: `<version> (<sha7>)` when both resolve, and
     * whichever one does when only one does. Never emits a dangling
     * separator or an empty parenthesis pair, and returns '' rather than
     * throwing when neither is available.
     *
     * @return string
     */
    public function getVersionDisplay(): string
    {
        $version = trim($this->getVersion());
        try {
            $commit = trim($this->getCommit());
        } catch (\Throwable $e) {
            $commit = '';
        }

        if ($version === '') {
            return $commit;
        }
        if ($commit === '') {
            return $version;
        }
        return $version . ' (' . $commit . ')';
    }

    /**
     * @inheritDoc
     */
    public function render(AbstractElement $element)
    {
        $element->unsScope()->unsCanUseWebsiteValue()->unsCanUseDefaultValue();
        return parent::render($element);
    }

    /**
     * @inheritDoc
     */
    public function _getElementHtml(AbstractElement $element)
    {
        return $this->_toHtml();
    }
}
