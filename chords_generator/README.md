# Chords Generator

Chord recognition microservice. Accepts an audio file path, decides the song's chords on its beat grid, and writes a chord timeline (JSON + MIREX LAB), the song's beats, downbeats and tempo, and simplified beginner/capo variants.

## How it works

```
full mix ──► Beat This!  ──► beats + downbeats ──┐
full mix ──► BTC ──┐                              ├─► one chord per beat (Viterbi) ─► chords.json
accompaniment ──► BTC ──┴─► averaged chord probabilities ──┘
```

1. **Beats** — [Beat This!](https://github.com/CPJKU/beat_this) (Foscarin et al., ISMIR 2024, MIT) finds the beats and the downbeats (beat 1 of each bar) on the full mix, drums included. `beats_per_bar` is the most common beat count between downbeats.
2. **Chord probabilities** — [BTC](https://github.com/jayg996/BTC-ISMIR19) (Park et al., ISMIR 2019, MIT), large vocabulary: every root with maj, min, 7, maj7, min7, 6, min6, sus2, sus4, dim, dim7, half-diminished, aug and min-maj7. It hears the full mix and, when the separated stems exist, the accompaniment mix (bass + guitar + piano + other); the two are averaged. `btc_model.py` is the inference-only model, trimmed from the original repo.
3. **Decoding** — `beat_decode.py` averages the probabilities over each beat and picks the best chord sequence with Viterbi. A change costs least on a downbeat, more on the half bar and most on other beats, so every change lands on a beat and one-beat flickers are smoothed out. The costs were tuned on 36 songs with published chord annotations (Billboard, Isophonics, uspop2002).

On those songs, compared with the autochord pipeline it replaced (as the player shows them): chords correct 64% → 72% (major/minor), 65% → 75% (root), 47% → 63% (sevenths); chord changes within ±0.15 s of the annotation 26% → 45%.

Slash bass (`C/G`) is added afterwards by `/detect-bass` from the separated bass stem.

## Setup

```bash
just setup-chords        # uv sync + downloads the pinned model weights into models/
just run-chords          # API on :8001
just test-chords-unit    # unit tests (no audio or models)
```

`scripts/download_models.sh` downloads the BTC and Beat This! weights at pinned versions and checks their SHA-256. The Docker image runs it at build time; `BTC_MODEL_PATH` and `BEAT_THIS_CHECKPOINT` override the paths.

PyTorch runs CPU-only (the Linux lock resolves the `+cpu` wheels). On Apple Silicon use a native arm64 Python: PyTorch has no wheels for Intel macOS.

## Docker / Lambda

```bash
docker build --platform linux/amd64 -t chords-generator .
docker run -p 8001:8001 chords-generator
```

Production runs the image on AWS Lambda behind the Lambda Web Adapter (`just deploy-chords`). A warm run takes about 15 s per song at 10 GB (6 vCPUs); the first request in a new container also pays a ~25 s cold start while Lambda loads the image.

## API Reference

See [API.md](API.md) for endpoints, request/response schemas, output files and configuration.
