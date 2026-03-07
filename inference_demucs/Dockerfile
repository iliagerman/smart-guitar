FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./

# 1) Install CPU-only torch first (before anything that depends on it)
# 2) Export remaining deps from lockfile, filter out CUDA/nvidia/triton/torch
# 3) Install with --no-deps so nothing transitively pulls CUDA torch back in
RUN uv venv && \
    uv pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    uv export --frozen --no-dev --no-hashes --no-emit-project \
      | grep -viE '^(nvidia-|cuda-|triton|torch==|torchaudio==)' > /tmp/reqs.txt && \
    uv pip install --no-deps -r /tmp/reqs.txt && \
    rm /tmp/reqs.txt && rm -rf /root/.cache/uv

# Prevent uv from re-syncing (we manually excluded CUDA packages)
ENV UV_NO_SYNC=1

COPY config/ ./config/
COPY src/ ./src/

# Install project package (deps already installed above)
RUN uv pip install -e . --no-deps

# Pre-download htdemucs_6s model at build time
RUN uv run python -c "from demucs.pretrained import get_model; get_model('htdemucs_6s')"

ENV APP_ENV=prod
ENV PATH="/app/.venv/bin:$PATH"
ENV HOME=/tmp
ENV PORT=8000
EXPOSE 8000
CMD ["uvicorn", "inference_demucs.api:app", "--host", "0.0.0.0", "--port", "8000"]
