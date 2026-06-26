#!/usr/bin/env bash
# make-bgm.sh — assets/bgm.mp3 (미니멀 신스/테크 BGM)을 ffmpeg로 합성한다.
#
# 왜 합성하나:
#   - TikTok 자동발행(Buffer)은 틱톡 인기음원을 못 붙인다 → 영상 파일에 음악을 미리 입혀야 함.
#   - 외부 음원은 라이선스·출처표기 리스크 → 직접 합성하면 저작권 100% 자유(§6 가드레일과 정합).
# 톤: A 단조 패드 + 110 BPM 게이트 베이스 + 가벼운 아르페지오 + 소프트 하이햇.
# 재생성:  bash scripts/make-bgm.sh   (ffmpeg 필요)
set -euo pipefail
DUR="${BGM_SECONDS:-60}"
OUT="$(dirname "$0")/../assets/bgm.mp3"
mkdir -p "$(dirname "$OUT")"

ffmpeg -y -loglevel error \
 -f lavfi -i "aevalsrc='0.18*sin(2*PI*220*t)+0.15*sin(2*PI*261.63*t)+0.13*sin(2*PI*329.63*t):s=44100:d=$DUR'" \
 -f lavfi -i "aevalsrc='0.9*sin(2*PI*110*t):s=44100:d=$DUR'" \
 -f lavfi -i "aevalsrc='0.10*sin(2*PI*440*t)+0.08*sin(2*PI*523.25*t)+0.07*sin(2*PI*659.25*t):s=44100:d=$DUR'" \
 -f lavfi -i "anoisesrc=color=white:sample_rate=44100:amplitude=0.06:duration=$DUR" \
 -filter_complex "\
 [0:a]lowpass=f=1800,apulsator=hz=0.2:amount=0.6:mode=sine,aecho=0.8:0.85:330|480:0.3|0.25,volume=0.9[pad];\
 [1:a]lowpass=f=180,apulsator=hz=1.8333:amount=1:mode=square,volume=0.8[bass];\
 [2:a]bandpass=f=900:width_type=h:w=900,apulsator=hz=3.6667:amount=1:mode=triangle,aecho=0.7:0.7:220:0.3,volume=0.55[arp];\
 [3:a]highpass=f=7000,apulsator=hz=3.6667:amount=1:mode=square:offset_l=0.5:offset_r=0.5,volume=0.5[hat];\
 [pad][bass][arp][hat]amix=inputs=4:normalize=0,alimiter=limit=0.95,afade=t=in:st=0:d=2,afade=t=out:st=$((DUR-3)):d=3,aresample=44100[mix]" \
 -map "[mix]" -c:a libmp3lame -q:a 4 "$OUT"

echo "✓ $OUT"
