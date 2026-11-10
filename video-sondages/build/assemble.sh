#!/bin/bash
# Assemble les morceaux vidéo + voix + bruitages → MP4 1080×1920 prêt pour TikTok.
set -e
cd "$(dirname "$0")/out"
printf "file 'chunks/c0.mp4'\nfile 'chunks/c1.mp4'\nfile 'chunks/c2.mp4'\nfile 'chunks/c3.mp4'\n" > list.txt
ffmpeg -v error -y -f concat -safe 0 -i list.txt -i narration.wav -i sfx.wav \
  -filter_complex "[1:a]pan=stereo|c0=c0|c1=c0,volume=1.0[v];[2:a]volume=${SFX_GAIN:-0.42}[s];[v][s]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.2:LRA=9[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "${1:-../../sondages_v1.mp4}"
