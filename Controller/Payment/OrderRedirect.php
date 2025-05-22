<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace ABN\GatewayHyva\Controller\Payment;

use Exception;
use Magento\Framework\App\Action\Action;
use Magento\Framework\App\Action\Context;
use Magento\Framework\Stdlib\CookieManagerInterface;
use Magento\Framework\Controller\Result\Redirect;

/**
 * Order Redirect controller
 */
class OrderRedirect extends Action
{

    /**
    * @var CookieManagerInterface
     */
    protected $cookieManager;

    /**
     * @var Redirect
     */
    protected $resultRedirectFactory;

    public function __construct(
        Context $context,
        CookieManagerInterface $cookieManager,
        Redirect $resultRedirectFactory
    ) {
        $this->cookieManager = $cookieManager;
        $this->resultRedirectFactory = $resultRedirectFactory;
        parent::__construct($context);
    }

    /**
     * @return ResponseInterface
     * @throws Exception
     */
    public function execute()
    {
        // Get the cookie value
        $redirectUrl = $this->cookieManager->getCookie('abn_redirect_url');
        $resultRedirect = $this->resultRedirectFactory->create();
        $resultRedirect->setUrl($redirectUrl);
        return $resultRedirect;
    }
}
