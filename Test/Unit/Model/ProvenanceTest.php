<?php

declare(strict_types=1);

namespace Two\GatewayHyva\Test\Unit\Model;

use Magento\Framework\Component\ComponentRegistrar;
use PHPUnit\Framework\TestCase;
use Two\GatewayHyva\Model\Provenance;

/**
 * The commit shown in the admin version field is a support tool: the whole
 * point is that it is right, or absent — never wrong and never fatal.
 *
 * Resolution order under test is gitlink -> Composer reference -> build
 * stamp, freshness-ranked (see Provenance's class docblock). Each case below
 * plants MORE than one signal so the assertion proves precedence, not just
 * that the branch works in isolation.
 */
class ProvenanceTest extends TestCase
{
    /** @var list<string> */
    private array $tempDirs = [];

    protected function tearDown(): void
    {
        foreach ($this->tempDirs as $dir) {
            foreach (['.git', '.two-deployed-commit', 'composer.json', 'registration.php'] as $file) {
                @unlink($dir . '/' . $file);
            }
            @rmdir($dir);
        }
        $this->tempDirs = [];
        parent::tearDown();
    }

    private function moduleDir(): string
    {
        $dir = sys_get_temp_dir() . '/two-hyva-prov-' . bin2hex(random_bytes(6));
        mkdir($dir, 0777, true);
        $this->tempDirs[] = $dir;
        return $dir;
    }

    /**
     * Provenance with the Composer registry seam stubbed, so tests never
     * depend on what happens to be composer-installed in the runner.
     */
    private function provenance(?string $composerRef): Provenance
    {
        return new class (new ComponentRegistrar(), $composerRef) extends Provenance {
            private ?string $ref;

            public function __construct(ComponentRegistrar $registrar, ?string $ref)
            {
                parent::__construct($registrar);
                $this->ref = $ref;
            }

            protected function composerReference(string $packageName): ?string
            {
                return $this->ref;
            }
        };
    }

    /**
     * gitSync deploys move the gitlink on every pull, so it is the only
     * signal that reflects what is checked out right now — it must beat both
     * the install-time Composer reference and the build-time stamp even when
     * all three are present.
     */
    public function testGitlinkWinsOverComposerAndStamp(): void
    {
        $dir = $this->moduleDir();
        file_put_contents($dir . '/.git', "gitdir: ../../.git/worktrees/aaaaaaa\n");
        file_put_contents($dir . '/.two-deployed-commit', "ccccccc\n");

        $this->assertSame('aaaaaaa', $this->provenance('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')->commitForPath($dir));
    }

    /**
     * Packagist install: no gitlink exists at all, so the installed
     * registry's source reference is the live signal and outranks the frozen
     * build stamp.
     */
    public function testComposerReferenceWinsOverStampWhenNoGitlink(): void
    {
        $dir = $this->moduleDir();
        file_put_contents($dir . '/composer.json', '{"name":"two-inc/magento2-hyva-checkout"}');
        file_put_contents($dir . '/.two-deployed-commit', "ccccccc\n");

        $this->assertSame('bbbbbbb', $this->provenance('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')->commitForPath($dir));
    }

    /**
     * Zip drop — the shape `make archive` exists to serve. Neither gitlink
     * nor Composer entry, so the stamp is the only thing left.
     */
    public function testStampUsedWhenItIsTheOnlySignal(): void
    {
        $dir = $this->moduleDir();
        file_put_contents($dir . '/.two-deployed-commit', "CCCCCCCdeadbeef\n");

        // Uppercase and over-length input is normalised to a 7-char lowercase
        // SHA rather than rejected: `git rev-parse` output is lowercase, but
        // a hand-edited or full-length stamp should not silently disable the
        // field.
        $this->assertSame('ccccccc', $this->provenance(null)->commitForPath($dir));
    }

    /**
     * A gitlink that does not carry a SHA-named worktree (an ordinary
     * submodule gitlink, say) must fall THROUGH to the next signal, not
     * short-circuit resolution to ''.
     */
    public function testMalformedGitlinkFallsThroughToComposer(): void
    {
        $dir = $this->moduleDir();
        file_put_contents($dir . '/.git', "gitdir: ../../.git/modules/hyva\n");
        file_put_contents($dir . '/composer.json', '{"name":"two-inc/magento2-hyva-checkout"}');

        $this->assertSame('bbbbbbb', $this->provenance('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')->commitForPath($dir));
    }

    /**
     * A branch/path-repo Composer install carries a non-hex reference like
     * `dev-staging`; that is not a commit, so it must not be surfaced as one
     * and must not block the stamp behind it.
     */
    public function testNonHexComposerReferenceFallsThroughToStamp(): void
    {
        $dir = $this->moduleDir();
        file_put_contents($dir . '/composer.json', '{"name":"two-inc/magento2-hyva-checkout"}');
        file_put_contents($dir . '/.two-deployed-commit', "ccccccc\n");

        $this->assertSame('ccccccc', $this->provenance('dev-staging')->commitForPath($dir));
    }

    /**
     * Junk in the stamp is discarded rather than rendered. Anything else
     * would put a fake commit in front of support engineers.
     */
    public function testMalformedStampIsIgnored(): void
    {
        $dir = $this->moduleDir();
        file_put_contents($dir . '/.two-deployed-commit', "not-a-sha\n");

        $prov = $this->provenance(null);
        $this->assertNull($prov->commitFromStamp($dir));
        $this->assertSame('', $prov->commitForPath($dir));
    }

    /**
     * A stamp shorter than 7 hex chars cannot be a resolvable SHA prefix, so
     * it is rejected rather than padded or truncated-through.
     */
    public function testTooShortStampIsIgnored(): void
    {
        $dir = $this->moduleDir();
        file_put_contents($dir . '/.two-deployed-commit', "abc123\n");

        $this->assertNull($this->provenance(null)->commitFromStamp($dir));
    }

    /**
     * Plain source drop with no signal at all: '' and no exception. A
     * throwing provenance lookup would take the admin config page down over
     * a missing dotfile.
     */
    public function testNoSignalYieldsEmptyStringAndDoesNotThrow(): void
    {
        $dir = $this->moduleDir();

        $this->assertSame('', $this->provenance(null)->commitForPath($dir));
    }

    /**
     * An unreadable/nonexistent module directory is the same non-event: no
     * warning-to-exception escalation, no throw.
     */
    public function testUnreadablePathYieldsEmptyStringAndDoesNotThrow(): void
    {
        $this->assertSame(
            '',
            $this->provenance(null)->commitForPath('/nonexistent/two/hyva/' . bin2hex(random_bytes(4)))
        );
    }

    /**
     * commitForModule() resolves through the registrar; an unregistered
     * module (the Hyva extension absent from a vanilla install) returns ''
     * rather than blowing up.
     */
    public function testCommitForModuleResolvesViaRegistrarAndToleratesUnregistered(): void
    {
        $dir = $this->moduleDir();
        file_put_contents($dir . '/.two-deployed-commit', "ccccccc\n");

        $registrar = new ComponentRegistrar();
        $registrar->setPathForTest(ComponentRegistrar::MODULE, 'Two_GatewayHyva', $dir);
        $prov = new Provenance($registrar);

        $this->assertSame('ccccccc', $prov->commitForModule('Two_GatewayHyva'));
        $this->assertSame('', $prov->commitForModule('Two_NotInstalled'));
    }

    /**
     * Resolution touches the filesystem on every call, so the result is
     * memoised per path — the memo must survive the signal disappearing
     * mid-request.
     */
    public function testResultIsMemoisedPerPath(): void
    {
        $dir = $this->moduleDir();
        file_put_contents($dir . '/.two-deployed-commit', "ccccccc\n");

        $prov = $this->provenance(null);
        $this->assertSame('ccccccc', $prov->commitForPath($dir));
        unlink($dir . '/.two-deployed-commit');
        $this->assertSame('ccccccc', $prov->commitForPath($dir));
    }
}
