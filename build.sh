#!/bin/bash
set -e
cd "$(dirname "$0")"
cat src/01_head.html src/05_peerjs.html src/02_script_open.html src/10_words.js src/20_core.js src/30_battle.js src/35_room.js src/50_stats.js src/60_data.js src/99_tail.html > word-battle.html
echo "built: word-battle.html ($(wc -c < word-battle.html) bytes)"
