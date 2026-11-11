#!/usr/bin/env bash
# dev/check-php-patch.sh <container> <image>
#
# Checks that a CI image runs the newest patch of its PHP minor (TWO-27174).
# Reads PHP_VERSION from inside the running container, then asks php.net for
# that minor's newest patch and its release date
# (https://www.php.net/releases/?json&version=<minor>; for an end-of-life minor
# that is its final patch).
#
#   - running the newest patch: prints it and passes;
#   - behind, however long: one ::warning:: naming the image, the running
#     patch and the newest one.
#
# It never fails the leg. A container whose PHP can't be read, or a php.net
# lookup that fails or lists no release, is a warning too: the leg's own steps
# report a broken container, and php.net being down says nothing about the
# code under test.
#
# Canonical copy: two-inc/magento-plugin. magento-hyva-extension carries a
# byte-identical copy, enforced by its matrix-script parity check.
set -uo pipefail

container=${1:?usage: $0 <container> <image>}
image=${2:?usage: $0 <container> <image>}

warn() {
    echo "::warning title=$1::$2"
    exit 0
}

running=$(docker exec "$container" php -r 'echo PHP_VERSION;' 2>/dev/null) || running=
[[ $running =~ ^([0-9]+)\.([0-9]+)\.[0-9]+ ]] \
    || warn "PHP patch not checked" "$image: could not read the PHP version inside the container (got '$running')"
minor="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"

release=$(curl -fsSL --retry 3 --retry-all-errors --retry-delay 3 --max-time 30 \
    "https://www.php.net/releases/?json&version=$minor") \
    || warn "PHP patch not checked" "$image runs PHP $running; could not query php.net for the newest $minor patch"
latest=$(jq -r '.version // empty' <<<"$release" 2>/dev/null) || latest=
released=$(jq -r '.date // empty' <<<"$release" 2>/dev/null) || released=
[ -n "$latest" ] && [ -n "$released" ] \
    || warn "PHP patch not checked" "$image runs PHP $running; php.net lists no release for PHP $minor"

newest=$(printf '%s\n%s\n' "$running" "$latest" | sort -V | tail -1)
if [ "$newest" = "$running" ]; then
    echo "$image runs PHP $running, the newest $minor patch (php.net: $latest, released $released)"
    exit 0
fi
warn "PHP patch behind" "$image runs PHP $running; php.net's newest $minor patch is $latest, released $released"
