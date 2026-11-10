#!/usr/bin/env python3
"""Synthèse des bruitages (aucun échantillon externe) à partir de la liste émise par les scènes."""
import json, sys, wave
import numpy as np
from pathlib import Path
SR = 48000
ROOT = Path(__file__).resolve().parent
ev = json.load(open(ROOT / 'out/sfx.json')); total = json.load(open(ROOT / 'out/timeline.json'))['total']
rng = np.random.default_rng(7)
T = lambda d: np.arange(int(d * SR)) / SR
def bp(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    g = 1 / (1 + (lo / np.maximum(f, 1)) ** 6) / (1 + (f / hi) ** 6); return np.fft.irfft(X * g, len(x))
noise = lambda d: rng.standard_normal(int(d * SR))
dec = lambda t, tau: np.exp(-t / tau)
def sweep(d, f0, f1): t = T(d); return np.sin(2 * np.pi * np.cumsum(f0 * (f1 / f0) ** (t / d)) / SR)
def thunk(d=.22, f0=150, f1=55): t = T(d); return sweep(d, f0, f1) * dec(t, d / 3.5) + .35 * bp(noise(d), 80, 900) * dec(t, .02)
def clicks(d, times, f=2500, tau=.012):
    y = np.zeros(int(d * SR))
    for x in times:
        n = T(.06); c = (np.sin(2 * np.pi * f * (1 + .2 * rng.random()) * n) + .6 * bp(noise(.06), 1500, 7000)) * dec(n, tau); i = int(x * SR); y[i:i + len(c)] += c[:len(y) - i]
    return y
def make(name):
    if name == 'whoosh': t = T(.42); return bp(noise(.42), 300, 3800) * np.sin(np.pi * t / .42) ** 2 * .8
    if name == 'boom': t = T(.9); return sweep(.9, 95, 36) * dec(t, .28) * 1.2 + .5 * bp(noise(.9), 40, 500) * dec(t, .05)
    if name == 'thunk': return thunk()
    if name == 'stamp': t = T(.25); return np.pad(thunk(.2, 190, 70), (0, int(.05 * SR))) + .7 * bp(noise(.25), 900, 4200) * dec(t, .022)
    if name == 'ding': t = T(.7); return (np.sin(2 * np.pi * 1318.5 * t) + .5 * np.sin(2 * np.pi * 1975.5 * t) + .25 * np.sin(2 * np.pi * 2637 * t)) * dec(t, .16) * .5
    if name == 'pop': t = T(.09); return sweep(.09, 380, 950) * np.sin(np.pi * t / .09) * .8
    if name == 'tick': t = T(.04); return np.sin(2 * np.pi * 2300 * t) * dec(t, .008) * .7
    if name == 'coin': t = T(.22); return (np.sin(2 * np.pi * 3136 * t) + .7 * np.sin(2 * np.pi * 4699 * t)) * dec(t, .045) * .45
    if name == 'gavel': t = T(.5); y = (np.sin(2 * np.pi * 410 * t) + .8 * np.sin(2 * np.pi * 175 * t)) * dec(t, .05) + .6 * bp(noise(.5), 500, 3500) * dec(t, .012); return y + .35 * np.roll(y, int(.07 * SR)) * (t > .07)
    if name == 'gears': d = 3.2; t = T(d); env = np.minimum(1, t / .3) * np.minimum(1, (d - t) / .5); return (clicks(d, np.arange(.05, d - .1, .085), 1700, .007) * .55 + .25 * np.sin(2 * np.pi * 62 * t) * (1 + .3 * np.sin(2 * np.pi * 7 * t))) * env
    if name == 'glitch': d = .11; y = bp(noise(d), 600, 9000); q = np.repeat(y[::37], 37)[:len(y)]; return np.sign(q) * np.abs(q) ** .5 * (rng.random(len(y) // 400 + 1).repeat(400)[:len(y)] > .35) * .35
    if name == 'snip': return clicks(.25, [0, .09], 5200, .014) * .9 + np.pad(bp(noise(.1), 3500, 11000) * dec(T(.1), .02), (int(.09 * SR), int(.06 * SR))) * .6
    if name == 'paper': t = T(.3); return bp(noise(.3), 1800, 9000) * np.sin(np.pi * t / .3) * (.6 + .4 * np.sin(2 * np.pi * 23 * t)) * .5
    if name == 'tvhum': d = 1.6; t = T(d); return ((.5 * np.sin(2 * np.pi * 50 * t) + .35 * np.sin(2 * np.pi * 100 * t) + .2 * np.sin(2 * np.pi * 15734 / 4 * t) * .3) + .25 * bp(noise(d), 2000, 9000) * (rng.random(len(t) // 600 + 1).repeat(600)[:len(t)] > .5)) * np.minimum(1, t / .05) * dec(t, .55) * .6
    if name == 'fall': t = T(.4); return np.concatenate([sweep(.4, 620, 140) * np.sin(np.pi * t / .4) * .5, thunk(.2, 120, 50)])
    if name == 'riser': t = T(1.0); return (bp(noise(1.0), 400, 5000) * .4 + .35 * sweep(1.0, 180, 820)) * (t / 1.0) ** 2 * (1 - pr_end(t, 1.0))
    if name == 'chain': return clicks(.6, [0, .08, .17, .25, .36, .45], 3300, .01) * .6
    if name == 'domino': t = T(.07); return (np.sin(2 * np.pi * 880 * t) + .5 * bp(noise(.07), 900, 5000)) * dec(t, .012) * .7
    raise KeyError(name)
def pr_end(t, d): return np.clip((t - (d - .04)) / .04, 0, 1)
L = np.zeros(int((total + .5) * SR)); R = L.copy(); cache = {}
for i, e in enumerate(ev):
    y = make(e['name']); y = y / (np.max(np.abs(y)) + 1e-9) * {'whoosh': .5, 'boom': .95, 'gears': .5, 'tvhum': .6, 'glitch': .4, 'tick': .5, 'coin': .5, 'domino': .55}.get(e['name'], .7) * e.get('gain', 1)
    f = int(.004 * SR); y[:f] *= np.linspace(0, 1, f); y[-f:] *= np.linspace(1, 0, f)
    pan = .5 + (rng.random() - .5) * .5; i0 = max(0, int(e['t'] * SR)); n = min(len(y), len(L) - i0)
    if n <= 0: continue
    L[i0:i0 + n] += y[:n] * np.cos(pan * np.pi / 2) * 1.2; R[i0:i0 + n] += y[:n] * np.sin(pan * np.pi / 2) * 1.2
st = np.stack([L, R], 1); st = np.tanh(st * 1.1) * .85
with wave.open(str(ROOT / 'out/sfx.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st * 32767).astype(np.int16).tobytes())
print(len(ev), 'bruitages →', ROOT / 'out/sfx.wav')
