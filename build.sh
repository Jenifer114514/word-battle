#!/bin/bash
set -e
cd "$(dirname "$0")"
cat src/01_head.html src/05_peerjs.html src/02_script_open.html src/10_words.js src/20_core.js src/30_battle.js src/35_room.js src/50_stats.js src/60_data.js src/99_tail.html > word-battle.html
python3 - <<'PY'
import re
h=open('word-battle.html',encoding='utf-8').read()
m=re.search(r'<div id="modalroot"></div>(.*?)<script>',h,re.S)
assert m and m.group(1).strip()=='', 'ERROR: modalroot と script の間に不正な内容があります'
css=h[h.index('<style>')+7:h.index('</style>')]
assert css.count('{')==css.count('}'), 'ERROR: CSSの波括弧が不整合'
print('structure OK')
PY
echo "built: word-battle.html ($(wc -c < word-battle.html) bytes)"
