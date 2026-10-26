#!/bin/sh
set -eu
umask 077
: "${FUELLOG_SECURITY_PRIVATE_KEY_BASE64:?Private key is required}"
: "${FUELLOG_SECURITY_PUBLIC_KEY_BASE64:?Public key is required}"
key_dir=$(mktemp -d /tmp/fuellog-keys.XXXXXX)
printf '%s' "$FUELLOG_SECURITY_PRIVATE_KEY_BASE64" | base64 -d > "$key_dir/private.pem"
printf '%s' "$FUELLOG_SECURITY_PUBLIC_KEY_BASE64" | base64 -d > "$key_dir/public.pem"
export FUELLOG_SECURITY_PRIVATE_KEY="file:$key_dir/private.pem"
export FUELLOG_SECURITY_PUBLIC_KEY="file:$key_dir/public.pem"
unset FUELLOG_SECURITY_PRIVATE_KEY_BASE64 FUELLOG_SECURITY_PUBLIC_KEY_BASE64
exec java -jar /application/application.jar "$@"
