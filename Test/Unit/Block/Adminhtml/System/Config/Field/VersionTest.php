<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Block\Adminhtml\System\Config\Field;

use Magento\Backend\Block\Template\Context;
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\Component\ComponentRegistrar;
use PHPUnit\Framework\TestCase;
use Two\GatewayHyva\Block\Adminhtml\System\Config\Field\Version;
use Two\GatewayHyva\Model\Provenance;

/**
 * The admin config page must render whatever provenance is available and
 * survive none being available. A dangling separator ("2.0.3 ()") reads as a
 * bug, and a thrown exception takes the whole Two configuration section down.
 */
class VersionTest extends TestCase
{
    private function block(?string $configuredVersion, string $commit): Version
    {
        $scopeConfig = new class ($configuredVersion) implements ScopeConfigInterface {
            private ?string $value;

            public function __construct(?string $value)
            {
                $this->value = $value;
            }

            public function getValue($path, $scope = 'default', $scopeCode = null)
            {
                return $path === 'two_hyva/general/version' ? $this->value : null;
            }
        };

        $provenance = new class (new ComponentRegistrar(), $commit) extends Provenance {
            private string $commit;

            public function __construct(ComponentRegistrar $registrar, string $commit)
            {
                parent::__construct($registrar);
                $this->commit = $commit;
            }

            public function commitForModule(string $moduleName): string
            {
                return $this->commit;
            }
        };

        return new Version($scopeConfig, new Context(), $provenance);
    }

    public function testVersionAndCommitRenderTogether(): void
    {
        $this->assertSame('2.0.3 (abc1234)', $this->block('2.0.3', 'abc1234')->getVersionDisplay());
    }

    /**
     * Packagist/source installs with no resolvable signal keep the exact
     * pre-TWO-25205 output — no empty brackets, no trailing space.
     */
    public function testUnresolvedCommitLeavesBareVersion(): void
    {
        $this->assertSame('2.0.3', $this->block('2.0.3', '')->getVersionDisplay());
    }

    /**
     * A shop whose CCD row was never written (fresh install before
     * setup:upgrade) should still show the commit rather than "(abc1234)".
     */
    public function testMissingVersionLeavesBareCommit(): void
    {
        $this->assertSame('abc1234', $this->block(null, 'abc1234')->getVersionDisplay());
    }

    public function testNeitherSignalYieldsEmptyStringAndDoesNotThrow(): void
    {
        $this->assertSame('', $this->block(null, '')->getVersionDisplay());
    }

    /**
     * getVersion() keeps its original meaning — the raw CCD value — so any
     * other consumer of it is unaffected by the display change.
     */
    public function testGetVersionStillReturnsRawConfigValue(): void
    {
        $block = $this->block('2.0.3', 'abc1234');
        $this->assertSame('2.0.3', $block->getVersion());
        $this->assertSame('abc1234', $block->getCommit());
    }

    /**
     * Belt and braces: even if a future resolver throws despite its own
     * guarantees, the field renders the version rather than 500-ing the
     * config page.
     */
    public function testThrowingProvenanceStillRendersBareVersion(): void
    {
        $provenance = new class (new ComponentRegistrar()) extends Provenance {
            public function commitForModule(string $moduleName): string
            {
                throw new \RuntimeException('boom');
            }
        };
        $scopeConfig = new class implements ScopeConfigInterface {
            public function getValue($path, $scope = 'default', $scopeCode = null)
            {
                return '2.0.3';
            }
        };

        $block = new Version($scopeConfig, new Context(), $provenance);
        $this->assertSame('2.0.3', $block->getVersionDisplay());
    }
}
