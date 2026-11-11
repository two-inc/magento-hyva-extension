#!/usr/bin/env bash
# dev/check-php-patch.sh <container> <image>
#
# Checks that a CI image runs the newest patch of its PHP minor (TWO-27174).
# Reads PHP_VERSION from inside the running container, then asks php.net for
# that minor's newest patch and its release date
# (https://www.php.net/releases/?json&version=<minor>; for an end-of-life minor
# that is its final patch).
#
#   - running the newest patch (or one php.net hasn't listed yet): prints it
#     and passes;
#   - behind, however long: one ::warning:: naming the image, the running
#     patch and the newest one. A pre-release build such as 8.3.36-dev or
#     8.4.0RC1 counts as behind 8.3.36 or 8.4.0.
#
# It never fails the leg. A container whose PHP can't be read, a php.net
# answer that can't be read, or one that lists no release for the minor, is a
# warning too, each with its own message: the leg's own steps report a broken
# container, and php.net being down says nothing about the code under test.
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
[[ $running =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(.*)$ ]] \
    || warn "PHP patch not checked" "$image: could not read the PHP version inside the container (got '$running')"
minor="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
base="$minor.${BASH_REMATCH[3]}"
# Anything after X.Y.Z ("-dev", "RC1", "alpha2") marks a pre-release of X.Y.Z.
prerelease=${BASH_REMATCH[4]}

unreadable="$image runs PHP $running; could not read php.net's newest $minor patch"
release=$(curl -fsSL --retry 3 --retry-all-errors --retry-delay 3 --max-time 30 \
    "https://www.php.net/releases/?json&version=$minor") \
    || warn "PHP patch not checked" "$unreadable"
# php.net answers a minor it has no release for with {"error": ...}. Any other
# body that is not a release (a maintenance page, a truncated reply) means
# php.net could not be read, which says nothing about the minor.
shape=$(jq -r 'if type != "object" then "unreadable"
    elif (.version | type) == "string" and (.date | type) == "string" then "release"
    elif has("error") then "none"
    else "unreadable" end' <<<"$release" 2>/dev/null) || shape=unreadable
case $shape in
    release) ;;
    none) warn "PHP patch not checked" "$image runs PHP $running; php.net lists no release for PHP $minor" ;;
    *) warn "PHP patch not checked" "$unreadable" ;;
esac
latest=$(jq -r '.version' <<<"$release")
released=$(jq -r '.date' <<<"$release")

if [ "$base" = "$latest" ] && [ -z "$prerelease" ]; then
    echo "$image runs PHP $running, the newest $minor patch (php.net: $latest, released $released)"
    exit 0
fi
newest=$(printf '%s\n%s\n' "$base" "$latest" | sort -V | tail -1)
if [ "$base" != "$latest" ] && [ "$newest" = "$base" ]; then
    echo "$image runs PHP $running, ahead of php.net's newest $minor patch ($latest, released $released)"
    exit 0
fi
warn "PHP patch behind" "$image runs PHP $running; php.net's newest $minor patch is $latest, released $released"
