import sys, wave
import numpy as np

SR, DUR = 48000, 10.0
rng = np.random.default_rng(1127)
n = int(SR * DUR)
t = np.arange(n) / SR


def one_pole(x, a):
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += a * (v - acc)
        y[i] = acc
    return y


def channel():
    room = one_pole(rng.standard_normal(n), 0.004)
    room /= np.abs(room).max()
    wind = one_pole(rng.standard_normal(n), 0.03) - one_pole(rng.standard_normal(n), 0.002)
    wind *= 0.6 + 0.4 * np.sin(2 * np.pi * 0.09 * t + rng.uniform(0, 6))
    wind /= np.abs(wind).max()
    roar = one_pole(rng.standard_normal(n), 0.01)
    roar *= 1 + 0.5 * np.sin(2 * np.pi * 0.7 * t) * np.sin(2 * np.pi * 0.23 * t)
    roar /= np.abs(roar).max()

    crackle = np.zeros(n)
    times = np.cumsum(rng.exponential(1 / 9.0, 200))
    for ts in times[times < DUR - 0.05]:
        length = int(SR * rng.uniform(0.002, 0.03))
        start = int(ts * SR)
        burst = rng.standard_normal(length) * np.exp(-np.linspace(0, rng.uniform(4, 9), length))
        burst = np.diff(burst, prepend=0) if rng.random() < 0.6 else burst
        crackle[start:start + length] += burst * rng.uniform(0.1, 1.0) ** 2
    crackle /= np.abs(crackle).max()
    return 0.10 * room + 0.10 * wind + 0.22 * roar + 0.38 * crackle


left, right = channel(), channel()
mix = np.stack([0.8 * left + 0.2 * right, 0.2 * left + 0.8 * right], axis=1)
fade = np.clip(t / 0.9, 0, 1) * np.clip((DUR - t) / 0.8, 0, 1)
mix *= fade[:, None] ** 2
mix *= 0.5 / np.abs(mix).max()

out = sys.argv[1] if len(sys.argv) > 1 else 'out/ambience.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print(out)
