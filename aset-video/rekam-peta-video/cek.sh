#!/bin/sh
# cek.sh d|m : encode mp4 lalu cetak beda rata-rata antar frame berurutan
D=$1
ffmpeg -y -loglevel error -framerate 30 -i $D/frames/%04d.jpg -c:v libx264 -crf 14 -pix_fmt yuv420p -r 30 $D/peta.mp4
ffmpeg -loglevel error -i $D/peta.mp4 -vf "scale=400:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=$D/diff.txt" -f null -
grep YAVG $D/diff.txt | awk -F= '{printf "%d:%.1f ", NR+1, $2} END{print ""}'
