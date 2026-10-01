#!/usr/bin/env bash
# Download the pinned model weights into chords_generator/models/, checking
# their SHA-256. Skips files already present and intact.
set -euo pipefail

models_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/models}"
mkdir -p "${models_dir}"

fetch() {
  local name="$1" url="$2" sha="$3" path="${models_dir}/$1"
  if [[ -f "${path}" ]] && echo "${sha}  ${path}" | sha256sum -c --status 2>/dev/null; then
    return
  fi
  curl -fsSL --retry 3 -o "${path}.part" "${url}"
  echo "${sha}  ${path}.part" | sha256sum -c --status || { echo "checksum mismatch: ${name}" >&2; rm -f "${path}.part"; exit 1; }
  mv "${path}.part" "${path}"
}

# BTC large-vocabulary chord model (MIT), github.com/jayg996/BTC-ISMIR19
fetch btc_model_large_voca.pt \
  "https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/2682317be668032e6e4b269ded36adaa2ad57df0/test/btc_model_large_voca.pt" \
  1673d23f8f9a55ae7f9e8b80a51da616debb22675b8d8b67ea6ce0ef37b0ab51

# Beat This! beat/downbeat tracker (MIT), github.com/CPJKU/beat_this
fetch beat_this-final0.ckpt \
  "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt" \
  8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331
