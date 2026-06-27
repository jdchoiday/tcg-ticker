#!/usr/bin/env python3
"""make-bgm.py — 오리지널 8비트 칩튠 BGM (포켓몬 게임 '모험' 느낌, 저작권 자유).

실제 포켓몬 곡은 저작권 → 사용 불가. 멜로디는 베끼지 않고 새로 작곡.
사각파 리드 + 펄스 베이스 + 아르페지오 + 8비트 드럼. 표준 라이브러리만 사용.
영상(~42s)보다 길어야 하므로(루프 안 씀) ~50s 생성.
출력: assets/bgm.mp3   재생성:  python3 scripts/make-bgm.py
"""
import math, struct, wave, os, subprocess, random

SR = 44100
BPM = 152
BEAT = 60.0 / BPM
EIGHTH = BEAT / 2
random.seed(11)

A4 = 440.0
NAMES = {"C":-9,"C#":-8,"D":-7,"D#":-6,"E":-5,"F":-4,"F#":-3,"G":-2,"G#":-1,"A":0,"A#":1,"B":2}
def freq(n):
    if n == "R": return 0.0
    p, o = n[:-1], int(n[-1]); return A4 * 2 ** ((NAMES[p] + (o-4)*12)/12.0)

def square(f, t, duty=0.5):
    if f <= 0: return 0.0
    return 1.0 if (f*t - math.floor(f*t)) < duty else -1.0

def env(i, n, attack=0.004, release=0.025, sustain=0.6):
    t, dur = i/SR, n/SR
    a = min(1.0, t/attack) if attack > 0 else 1.0
    r = min(1.0, (dur-t)/release) if (dur-t) < release else 1.0
    return max(0.0,a)*max(0.0,r)*(sustain + (1-sustain)*math.exp(-t*7))

# --- 오리지널 멜로디 (밝고 통통, 8마디 A+B) ---
LEAD = [
  ("G5",1),("C6",1),("E6",1),("C6",1),("G5",1),("E5",1),("G5",1),("C6",1),   # C
  ("D6",1),("B5",1),("G5",1),("B5",1),("D6",1),("B5",1),("G5",2),            # G
  ("C6",1),("A5",1),("E5",1),("A5",1),("C6",1),("A5",1),("E6",2),            # Am
  ("A5",1),("C6",1),("F6",1),("C6",1),("A5",1),("F5",1),("A5",2),            # F
  ("E6",1),("D6",1),("C6",1),("D6",1),("E6",1),("G6",1),("E6",2),            # C
  ("D6",1),("B5",1),("D6",1),("G6",1),("F6",2),("D6",2),                     # G
  ("C6",1),("A5",1),("C6",1),("F6",1),("A6",2),("F6",2),                     # F
  ("G6",1),("F6",1),("E6",1),("D6",1),("G5",2),("R",2),                      # G
]
BASS = ["C3","G2","A2","F2","C3","G2","F2","G2"]   # 마디별 루트
# 아르페지오(브로큰 코드) — 게임 특유의 반짝임
ARP = [["C4","E4","G4"],["G3","B3","D4"],["A3","C4","E4"],["F3","A3","C4"],
       ["C4","E4","G4"],["G3","B3","D4"],["F3","A3","C4"],["G3","B3","D4"]]

def synth_lead():
    buf=[]
    for name,e in LEAD:
        n=int(round(EIGHTH*e*SR)); f=freq(name)
        for i in range(n): buf.append(0.24*env(i,n,sustain=0.5)*square(f,i/SR,0.5))
    return buf

def synth_bass():
    buf=[]
    for root in BASS:
        for _ in range(4):
            n=int(round(BEAT*SR)); f=freq(root)
            for i in range(n): buf.append(0.30*env(i,n,sustain=0.45)*square(f,i/SR,0.5))
    return buf

def synth_arp():
    buf=[]
    for chord in ARP:                       # 마디=4박, 16분음표로 코드 순환
        step=int(round((BEAT/4)*SR)); seq=chord*6  # 16칸
        for k in range(16):
            f=freq(seq[k])
            for i in range(step): buf.append(0.10*env(i,step,sustain=0.3)*square(f,i/SR,0.25))
    return buf

def synth_drums():
    total=int(round(BEAT*32*SR)); buf=[0.0]*total
    def add(at,n,fn):
        for i in range(n):
            if at+i<total: buf[at+i]+=fn(i)
    for bar in range(8):
        b0=int(round(bar*4*BEAT*SR))
        for beat in range(4):
            at=b0+int(round(beat*BEAT*SR))
            if beat in (0,2): add(at,int(0.12*SR),lambda i:0.55*math.exp(-i/SR*16)*math.sin(2*math.pi*(120*math.exp(-i/SR*30)+45)*i/SR))
            if beat in (1,3): add(at,int(0.10*SR),lambda i:0.24*math.exp(-i/SR*30)*(random.random()*2-1))
            for h in (0,1): add(at+int(h*EIGHTH*SR),int(0.025*SR),lambda i:0.06*math.exp(-i/SR*140)*(random.random()*2-1))
    return buf

def main():
    layers=[synth_lead(),synth_bass(),synth_arp(),synth_drums()]
    n=max(len(x) for x in layers); mix=[0.0]*n
    for L in layers:
        for i,s in enumerate(L): mix[i]+=s
    loops=max(1,int(math.ceil(50/(len(mix)/SR))))   # 영상보다 길게(~50s+)
    mix=mix*loops
    peak=max(1e-6,max(abs(x) for x in mix)); g=0.92/peak
    here=os.path.dirname(__file__); wav=os.path.join(here,"..","assets","bgm.wav")
    os.makedirs(os.path.dirname(wav),exist_ok=True)
    with wave.open(wav,"w") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        fr=bytearray()
        for x in mix:
            v=int(max(-1.0,min(1.0,x*g))*32767); fr+=struct.pack("<hh",v,v)
        w.writeframes(bytes(fr))
    mp3=os.path.join(here,"..","assets","bgm.mp3")
    subprocess.run(["ffmpeg","-y","-loglevel","error","-i",wav,"-c:a","libmp3lame","-q:a","4",mp3],check=True)
    os.remove(wav)
    print(f"✓ {mp3}  ({len(mix)/SR:.1f}s)")

if __name__=="__main__": main()
