FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./

# whisperx uses faster-whisper (CTranslate2) + torch for wav2vec2 alignment.
# After resolving all deps, replace torch/torchaudio with CPU-only wheels
# to drop ~5.7 GB of CUDA/nvidia/triton packages (Lambda is CPU-only).
RUN uv venv && \
    uv sync --frozen --no-dev && \
    uv pip uninstall torch torchaudio && \
    uv pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    rm -rf /app/.venv/lib/python3.11/site-packages/nvidia && \
    rm -rf /app/.venv/lib/python3.11/site-packages/triton && \
    rm -rf /root/.cache/uv

# Pre-download whisperx transcription model + wav2vec2 alignment model at build time.
# Placed BEFORE source code copy so this ~2 GB layer stays cached on code-only deploys.
ARG WHISPER_MODEL=medium
RUN XDG_CACHE_HOME=/app/.cache \
    TORCH_HOME=/app/.torch \
    HF_HOME=/app/.cache/huggingface \
    .venv/bin/python -W "ignore::UserWarning:pyannote.audio.core.io" -c "\
import whisperx; \
whisperx.load_model('${WHISPER_MODEL}', device='cpu', compute_type='int8'); \
whisperx.load_align_model(language_code='en', device='cpu'); \
whisperx.load_align_model(language_code='he', device='cpu')"

# Source code + config (small layers; change on every deploy)
COPY config/ ./config/
COPY src/ ./src/
COPY secrets.yml ./secrets.yml

# Install project package (deps already installed above)
RUN uv pip install -e . --no-deps

ENV APP_ENV=prod
ENV PATH="/app/.venv/bin:$PATH"
# Lambda's HOME is read-only; /tmp is the only writable dir.
ENV HOME=/tmp
# Point whisperx/torch at the pre-downloaded models baked into the image.
ENV XDG_CACHE_HOME=/app/.cache
ENV TORCH_HOME=/app/.torch
ENV HF_HOME=/app/.cache/huggingface
ENV HF_HUB_OFFLINE=1
ENV MPLCONFIGDIR=/tmp/matplotlib
# Suppress pyannote warning about missing torchcodec (not needed; falls back to torchaudio)
ENV PYTHONWARNINGS="ignore::UserWarning:pyannote.audio.core.io"
ENV PORT=8003
EXPOSE 8003
CMD ["uvicorn", "lyrics_generator.api:app", "--host", "0.0.0.0", "--port", "8003"]
