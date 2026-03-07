FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY config/ ./config/
COPY src/ ./src/

# Pre-download basic-pitch model at build time (skip under emulation where TensorFlow AVX fails)
RUN uv run python -c "from basic_pitch import ICASSP_2022_MODEL_PATH; print(ICASSP_2022_MODEL_PATH)" || echo "WARN: model pre-download skipped (will download at runtime)"

ENV APP_ENV=prod
ENV PATH="/app/.venv/bin:$PATH"
# Lambda's HOME is read-only; /tmp is the only writable dir.
ENV HOME=/tmp
ENV PORT=8004
EXPOSE 8004

CMD ["uvicorn", "tabs_generator.api:app", "--host", "0.0.0.0", "--port", "8004"]
