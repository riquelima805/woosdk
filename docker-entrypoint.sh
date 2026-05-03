#!/bin/sh
set -e

if [ -n "$PEERS" ]; then
    for peer in $(echo "$PEERS" | tr ',' ' '); do
        host=$(echo "$peer" | sed 's|ws://||' | cut -d':' -f1)
        port=$(echo "$peer" | sed 's|ws://||' | cut -d':' -f2)
        until nc -z "$host" "$port" 2>/dev/null; do
            sleep 2
        done
    done
fi

exec tsx src/rpc.ts
