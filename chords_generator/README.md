# Chords Generator

Chord recognition microservice using [autochord](https://github.com/urinieto/autochord). Accepts an audio file path, runs chord detection via a BiLSTM-CRF model over NNLS chromagram features, and outputs a chord timeline as JSON and MIREX LAB files.

## Architecture

```
audio file  -->  autochord (NNLS chroma + BiLSTM-CRF)  -->  chords.json + chords.lab
```

Key dependencies:

| Library                   | Role                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| `autochord`               | Chord recognition (wraps TensorFlow model + VAMP chroma extraction)  |
| `vamp` / `vampyhost`      | Python bindings for VAMP audio analysis plugins (C extension)        |
| `nnls-chroma`             | VAMP plugin that generates chromagram features from audio            |
| `tensorflow` + `tf-keras` | Neural network runtime (Keras 2 required for autochord's SavedModel) |
| `librosa`                 | Audio loading and resampling                                         |
| `FastAPI` + `Mangum`      | HTTP API, Lambda-deployable via Mangum                               |

## Platform Setup

autochord has native C dependencies (`vamp`, `nnls-chroma`) that require platform-specific setup. The three paths below are ordered from most complex to simplest.

---

### macOS Apple Silicon (arm64)

This is the most involved setup because:
- The `vamp` Python package compiles a C++ extension that needs explicit SDK paths on macOS
- The `nnls-chroma` VAMP plugin bundled with `autochord` is a **Linux ELF binary** and must be built from source for macOS
- TensorFlow 2.16+ ships Keras 3, which can't load autochord's legacy SavedModel

#### Step 1: Install system dependencies

```bash
brew install vamp-plugin-sdk boost
```

- `vamp-plugin-sdk` provides headers and the static library for building VAMP hosts and plugins
- `boost` provides `boost/lexical_cast.hpp` used by nnls-chroma source code

#### Step 2: Build the nnls-chroma VAMP plugin from source

The plugin source is at [c4dm/nnls-chroma](https://github.com/c4dm/nnls-chroma). The upstream `Makefile.osx` targets x86_64 and expects a local VAMP SDK checkout, so we override the flags to use Homebrew's installation and target arm64.

```bash
cd /tmp
git clone https://github.com/c4dm/nnls-chroma.git
cd nnls-chroma

CXXFLAGS="-arch arm64 -O3 -ffast-math \
  -I/opt/homebrew/opt/vamp-plugin-sdk/include \
  -I/opt/homebrew/include \
  -Wall -fPIC -stdlib=libc++ \
  -I$(xcrun --show-sdk-path)/usr/include/c++/v1" \
CFLAGS="-arch arm64 -O3 -ffast-math \
  -I/opt/homebrew/opt/vamp-plugin-sdk/include \
  -Wall -fPIC" \
make -f Makefile.osx \
  VAMP_SDK_DIR=/opt/homebrew/opt/vamp-plugin-sdk/include \
  BOOST_ROOT=/opt/homebrew/include \
  ARCHFLAGS="" \
  OPTFLAGS="" \
  LDFLAGS="-arch arm64 -dynamiclib -install_name nnls-chroma.dylib \
    /opt/homebrew/opt/vamp-plugin-sdk/lib/libvamp-sdk.a \
    -exported_symbols_list vamp-plugin.list -framework Accelerate"
```

What the flags do:
- `-I$(xcrun --show-sdk-path)/usr/include/c++/v1` — points the compiler to the macOS SDK's C++ standard library headers (without this, `#include <vector>` and `#include <string>` fail)
- `-arch arm64` — forces native ARM compilation (avoids accidental x86_64 Rosetta builds)
- `-framework Accelerate` — macOS linear algebra framework used by the NNLS solver
- `VAMP_SDK_DIR` / `BOOST_ROOT` — point to Homebrew's headers instead of local source checkouts

Install the resulting `.dylib`:

```bash
mkdir -p ~/Library/Audio/Plug-Ins/Vamp
cp nnls-chroma.dylib nnls-chroma.cat nnls-chroma.n3 ~/Library/Audio/Plug-Ins/Vamp/
```

Verify:

```bash
file ~/Library/Audio/Plug-Ins/Vamp/nnls-chroma.dylib
# Expected: Mach-O 64-bit dynamically linked shared library arm64
```

#### Step 3: Install Python dependencies

```bash
just setup-chords
```

This recipe (`justfile` line 92) does:

1. Creates a Python 3.11 venv (`uv venv --python 3.11`) — Python 3.11 is required because TensorFlow wheels for macOS ARM are most reliable on 3.11
2. Pre-installs `numpy` and `setuptools` — the `vamp` package imports them at build time in `setup.py` without declaring them as build dependencies, so they must exist before `uv sync`
3. Sets `CPLUS_INCLUDE_PATH` — same C++ header path fix as the nnls-chroma build
4. Sets `ARCHFLAGS="-arch arm64"` — ensures `vamp`'s C extension compiles as native arm64
5. Runs `uv sync` — installs all dependencies from `pyproject.toml`

#### Step 4: Run

```bash
just run-chords
# or
just test-chords cleanup=false
```

All `just` chords recipes set `TF_USE_LEGACY_KERAS=1` automatically. This env var tells TensorFlow to redirect `tensorflow.keras` to `tf-keras` (Keras 2), which supports autochord's legacy SavedModel format.

---

### Linux (x86_64)

On Linux the setup is straightforward because:
- The `nnls-chroma.so` bundled with `autochord` is already a Linux ELF x86_64 binary — no build from source needed
- `vamp` compiles without special flags
- System packages are available via apt

#### Step 1: Install system dependencies

```bash
# Debian/Ubuntu
sudo apt-get install -y vamp-plugin-sdk libsndfile1 ffmpeg libvamp-hostsdk3v5
```

#### Step 2: Install Python dependencies

```bash
cd chords_generator
uv venv --python 3.11
uv pip install numpy setuptools
uv sync
```

No `CPLUS_INCLUDE_PATH` or `ARCHFLAGS` needed — Linux has standard header paths.

#### Step 3: Run

```bash
TF_USE_LEGACY_KERAS=1 APP_ENV=local uv run uvicorn chords_generator.api:app --host 0.0.0.0 --port 8001
```

autochord will auto-copy the bundled `nnls-chroma.so` to the VAMP plugin path on first run.

---

### Docker (any platform)

The simplest approach. The Dockerfile handles all native dependencies.

```bash
cd chords_generator
docker build -t chords-generator .
docker run -p 8001:8001 -e TF_USE_LEGACY_KERAS=1 chords-generator
```

The Dockerfile:
- Uses `python:3.11-slim` as base
- Installs `vamp-plugin-sdk`, `libsndfile1`, `ffmpeg`, `libvamp-hostsdk3v5` via apt
- The bundled Linux `nnls-chroma.so` works out of the box in the container
- Pre-downloads the autochord model at build time so the first request doesn't trigger a download

For production (AWS Lambda), the image is deployed via Mangum which adapts FastAPI to Lambda's event format.

---

## Troubleshooting

| Symptom                                                              | Cause                                    | Fix                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `vamp` build fails: `'string' file not found`                        | macOS can't find C++ stdlib headers      | `export CPLUS_INCLUDE_PATH="$(xcrun --show-sdk-path)/usr/include/c++/v1"`                   |
| `vamp` .so is x86_64 on Apple Silicon                                | Cached wheel or missing arch flag        | `ARCHFLAGS="-arch arm64" uv pip install --no-cache-dir --reinstall vamp`                    |
| `No module named 'pkg_resources'`                                    | setuptools >= 82 removed it              | `setuptools<81` is pinned in pyproject.toml                                                 |
| `File format not supported: filepath=...chroma-seq-bilstm-crf-v1/`   | Keras 3 can't load legacy SavedModel     | Set `TF_USE_LEGACY_KERAS=1` (all just recipes do this)                                      |
| `autochord WARNING: NNLS-Chroma VAMP plugin not setup properly`      | Missing or wrong-arch nnls-chroma plugin | macOS: build from source (see above). Linux: auto-handled. Docker: auto-handled.            |
| `No library found in Vamp path for plugin "nnls-chroma:nnls-chroma"` | Plugin not in VAMP search path           | Copy `.dylib`/`.so` to `~/Library/Audio/Plug-Ins/Vamp/` (macOS) or `/usr/lib/vamp/` (Linux) |
| TensorFlow import is slow / warnings about GPU                       | TF defaults to scanning for GPUs         | Normal on CPU-only machines, does not affect results                                        |

## API Reference

See [API.md](API.md) for full endpoint documentation, request/response schemas, output format, storage backends, and configuration reference.

## Quick Reference

```bash
# Setup (macOS)
just setup-chords

# Run server
just run-chords

# Integration test (cleans output)
just test-chords

# Integration test (keeps output)
just test-chords cleanup=false

# Test with custom file
just test-chords /path/to/audio.mp3 cleanup=false
```
