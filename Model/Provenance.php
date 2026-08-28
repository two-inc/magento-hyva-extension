<?php
/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 */
declare(strict_types=1);

namespace Two\GatewayHyva\Model;

use Magento\Framework\Component\ComponentRegistrar;

/**
 * Resolves the commit this extension is running.
 *
 * Three deployment shapes exist in the wild and all three must resolve:
 *
 *  1. gitSync dev install. No composer package at all;
 *     `app/code/Two/GatewayHyva` is a symlink to the synced checkout, whose
 *     `.git` is a gitlink FILE (`gitdir: ../../.git/worktrees/<sha>`) —
 *     gitSync v4 names each worktree directory after the SHA it points at.
 *     The `gitdir:` target is typically DANGLING inside the container, so the
 *     SHA is string-parsed out of the gitlink; never shell out to `git`.
 *  2. Composer/Packagist install (the merchant distribution — the release
 *     workflow tags and Packagist resolves, there are no release assets).
 *     The module lives under vendor/ with no .git of any kind; Composer's
 *     installed registry records the exact source/dist reference —
 *     `Composer\InstalledVersions::getReference('two-inc/magento2-hyva-checkout')`
 *     returns the full release SHA.
 *  3. Zip drop. `make archive` produces a versioned zip that is unpacked
 *     straight into `app/code/Two/GatewayHyva` (the README's install path),
 *     carrying neither a `.git` nor a Composer registry entry — so neither
 *     signal above exists. `make archive` stamps a `.two-deployed-commit`
 *     file into the zip at build time to close that gap.
 *
 * Resolution order is `.git` gitlink → Composer reference →
 * `.two-deployed-commit` stamp, one org-wide order shared by all six Two
 * plugin artifacts (Magento, Magento Hyva, WooCommerce, PrestaShop and the
 * two partner-branded overlays). The order is freshness-ranked, not
 * confidence-ranked: the gitlink is the only signal that reflects what is
 * checked out *right now*, the Composer reference is recorded once at
 * install time, and the build stamp is frozen at build time and so is the
 * most likely of the three to be stale. Whichever is freshest and present
 * wins; a malformed signal falls through to the next rather than winning.
 *
 * None present (a plain source drop with no stamp) is a legitimate state:
 * every entry point returns '' rather than throwing, so callers degrade to a
 * bare version string and the admin panel still renders.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DUPLICATED (TWO-25205)
 * ---------------------------------------------------------------------------
 * The base plugin two-inc/magento2 owns the canonical implementation and this
 * class mirrors its contract deliberately — same order, same regexes, same
 * never-throw behaviour, same method names — rather than reusing it.
 *
 * Reuse would be the obvious call (this extension already sequences after
 * Two_Gateway and constructor-injects base classes elsewhere, so there is no
 * circularity), but no published base release carries the equivalent model:
 * every base version a merchant can actually install today lacks it, under
 * this extension's current constraint or the relaxation in flight. Injecting
 * it would make THIS block un-instantiable on every real install, i.e. a hard
 * DI failure and a broken admin config page, which is a wildly
 * disproportionate cost for a diagnostic string. Beyond that, the zip-drop
 * shape above has no vendor/ tree at all, so base-class autoloadability is not
 * something this artifact can assume.
 *
 * When a base release ships it AND this extension's constraint has a floor at
 * that release, delete this class and inject the base one — the public surface
 * is identical on purpose so that swap is a rename.
 */
class Provenance
{
    /**
     * Package name used for the Composer-registry lookup fallback when the
     * module directory carries no readable composer.json.
     */
    private const PACKAGE_NAME = 'two-inc/magento2-hyva-checkout';

    private ComponentRegistrar $componentRegistrar;

    /**
     * Per-request memo, keyed by module path. Resolution touches the
     * filesystem.
     *
     * @var array<string, string>
     */
    private array $commitCache = [];

    public function __construct(ComponentRegistrar $componentRegistrar)
    {
        $this->componentRegistrar = $componentRegistrar;
    }

    /**
     * 7-char commit SHA for a registered module, or '' when it cannot be
     * determined (module not registered, or no provenance signal present).
     */
    public function commitForModule(string $moduleName): string
    {
        try {
            $path = $this->componentRegistrar->getPath(ComponentRegistrar::MODULE, $moduleName);
        } catch (\Throwable $e) {
            return '';
        }
        if (!$path) {
            return '';
        }
        return $this->commitForPath($path);
    }

    /**
     * 7-char commit SHA for a module directory, or '' when undeterminable.
     *
     * Never throws: provenance is diagnostic metadata, and a broken admin
     * page would be a wildly disproportionate cost for an unreadable dotfile.
     */
    public function commitForPath(string $modulePath): string
    {
        if (isset($this->commitCache[$modulePath])) {
            return $this->commitCache[$modulePath];
        }
        try {
            $commit = $this->resolve($modulePath);
        } catch (\Throwable $e) {
            $commit = '';
        }
        $this->commitCache[$modulePath] = $commit;
        return $commit;
    }

    private function resolve(string $modulePath): string
    {
        // FIRST: the gitlink. It is the only signal that tracks what is
        // checked out right now — a gitSync pull moves it on every deploy,
        // where the Composer reference is fixed at install time and the
        // build stamp at build time.
        //
        // The gitlink lives at the checkout root, which for this top-level
        // module IS the module directory; the dirname() probe mirrors the
        // base implementation so a sub-path layout resolves identically.
        foreach ([$modulePath, dirname($modulePath)] as $dir) {
            $gitFile = $dir . '/.git';
            if (!is_file($gitFile)) {
                continue;
            }
            // .git is always `gitdir: <relpath>\n`; cap the read defensively
            // and trim before anchoring the regex to end-of-string so a
            // worktrees/<sha> segment elsewhere in the path can't shadow
            // the real SHA at the tail.
            $content = @file_get_contents($gitFile, false, null, 0, 1024);
            if ($content !== false
                && preg_match('#worktrees/([a-f0-9]{7,40})/?$#', trim($content), $m)
            ) {
                return substr($m[1], 0, 7);
            }
        }

        // SECOND: Composer-installed deploys (Packagist — the merchant
        // distribution model) put the module under vendor/ with NO .git
        // worktree. The installed registry records the exact source/dist
        // commit, recorded once at install time.
        $fromComposer = $this->commitFromComposer($modulePath);
        if ($fromComposer !== null) {
            return $fromComposer;
        }

        // THIRD: the build stamp. A zip-dropped module has neither of the
        // above; `make archive` writes the build commit into the zip. Frozen
        // at build time, hence last of the three.
        $fromStamp = $this->commitFromStamp($modulePath);
        if ($fromStamp !== null) {
            return $fromStamp;
        }

        // Legacy fallback: module path is a symlink through the worktree.
        $real = @realpath($modulePath . '/registration.php');
        if ($real && preg_match('#\.worktrees/([a-f0-9]{7,40})/#', $real, $m)) {
            return substr($m[1], 0, 7);
        }
        return '';
    }

    /**
     * 7-char commit SHA from Composer's installed registry, or null when the
     * module isn't composer-installed or carries no hex source reference.
     *
     * Reads the package name from composer.json (checking the module dir and
     * one level up), falling back to the compiled-in package name when no
     * composer.json is readable — a zip drop keeps composer.json, but a
     * partial deploy may not. A path-repo or branch install may carry a
     * non-SHA reference; the hex guard rejects those so the caller falls
     * through to the remaining signals.
     */
    public function commitFromComposer(string $modulePath): ?string
    {
        $names = [];
        foreach ([$modulePath, dirname($modulePath)] as $dir) {
            $composer = @file_get_contents($dir . '/composer.json');
            if ($composer === false) {
                continue;
            }
            $data = json_decode($composer, true);
            $name = is_array($data) ? ($data['name'] ?? null) : null;
            if (is_string($name) && $name !== '') {
                $names[] = $name;
            }
        }
        $names[] = self::PACKAGE_NAME;

        foreach (array_unique($names) as $name) {
            $ref = $this->composerReference($name);
            if (is_string($ref) && preg_match('/^[a-f0-9]{7,40}$/', $ref)) {
                return substr($ref, 0, 7);
            }
        }
        return null;
    }

    /**
     * 7-char commit SHA from the `.two-deployed-commit` build stamp, or null
     * when absent, unreadable or malformed.
     *
     * `make archive` writes the build commit into the release zip, which is
     * how a zip-dropped module reports its provenance at all — it carries
     * neither a `.git` nor a Composer registry entry. Checks the module dir
     * and one level up, mirroring the gitlink and composer.json lookups.
     *
     * Never throws, and a malformed or empty stamp returns null so the caller
     * falls THROUGH to the remaining fallback rather than surfacing junk as a
     * commit.
     */
    public function commitFromStamp(string $modulePath): ?string
    {
        foreach ([$modulePath, dirname($modulePath)] as $dir) {
            // Cap the read: a legitimate stamp is one short hex line.
            $raw = @file_get_contents($dir . '/.two-deployed-commit', false, null, 0, 128);
            if ($raw === false) {
                continue;
            }
            $candidate = trim($raw);
            if (preg_match('/^[a-f0-9]{7,40}$/i', $candidate)) {
                return strtolower(substr($candidate, 0, 7));
            }
        }
        return null;
    }

    /**
     * The installed package's source/dist reference (commit SHA), or null.
     * Wraps the static Composer registry as an override seam for testing.
     */
    protected function composerReference(string $packageName): ?string
    {
        if (!class_exists(\Composer\InstalledVersions::class)
            || !\Composer\InstalledVersions::isInstalled($packageName)
        ) {
            return null;
        }
        return \Composer\InstalledVersions::getReference($packageName);
    }
}
