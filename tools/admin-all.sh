#!/bin/bash
# Az admin összes oldala egy-egy képen + összefűzve: tools/admin-all.sh <kimeneti mappa> [W] [H] [TH] [LK]
S=$1; W=${2:-1366}; H=${3:-800}; TH=${4:-dark}; LK=${5:-new}
for n in dash shops sched acc inbox tix ann docs train set data; do W=$W H=$H TH=$TH LK=$LK NAV=$n O=$S/n_$n.png node tools/admin-shot.js | grep -v '"kilog":false} hibák: \[\]' | sed "s/^/$n: /" | cut -c1-300 & done; wait
cd $S && montage n_dash.png n_shops.png n_sched.png n_acc.png -tile 2x2 -geometry 960x+4+4 s1.png && montage n_inbox.png n_tix.png n_ann.png n_docs.png -tile 2x2 -geometry 960x+4+4 s2.png && montage n_train.png n_set.png n_data.png -tile 2x2 -geometry 960x+4+4 s3.png
