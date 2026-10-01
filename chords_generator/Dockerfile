FROM python:3.11-slim

# Audio decoding (libsndfile, ffmpeg); git and curl for the pinned git
# dependencies and model weights.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Lambda Web Adapter + uv
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

# Dependencies first (cached layer), then the project itself once src/ exists.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Pinned, checksummed model weights (BTC chords, Beat This! beats).
COPY scripts/download_models.sh ./scripts/
RUN bash scripts/download_models.sh /app/models

COPY config/ ./config/
COPY src/ ./src/
RUN uv sync --frozen --no-dev

ENV APP_ENV=prod
ENV PATH="/app/.venv/bin:$PATH"
# Lambda's default HOME is read-only; /tmp is the only writable dir.
ENV HOME=/tmp
ENV PORT=8001

EXPOSE 8001

CMD ["uvicorn", "chords_generator.api:app", "--host", "0.0.0.0", "--port", "8001"]
