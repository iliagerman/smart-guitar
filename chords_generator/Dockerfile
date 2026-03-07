FROM python:3.11-slim

# System dependencies for autochord (VAMP plugin host, audio libs, ffmpeg)
RUN apt-get update && apt-get install -y --no-install-recommends \
    vamp-plugin-sdk \
    libsndfile1 \
    ffmpeg \
    libvamp-hostsdk3v5 \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Lambda Web Adapter + uv
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

# Copy project files and install dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY config/ ./config/
COPY src/ ./src/

# Copy NNLS-Chroma VAMP plugin to a system dir (doesn't depend on HOME)
RUN mkdir -p /usr/lib/vamp && \
    cp /app/.venv/lib/python3.11/site-packages/autochord/res/nnls-chroma.so /usr/lib/vamp/ || true

# Pre-download autochord model at build time (HOME defaults to /root during build)
RUN uv run python -c "import autochord; autochord.recognize" || true

ENV APP_ENV=prod
ENV TF_USE_LEGACY_KERAS=1
ENV PATH="/app/.venv/bin:$PATH"
# Lambda's default HOME is read-only; /tmp is the only writable dir.
# autochord downloads its model to $HOME/.autochord/ on first import.
ENV HOME=/tmp
ENV PORT=8001

EXPOSE 8001

CMD ["uvicorn", "chords_generator.api:app", "--host", "0.0.0.0", "--port", "8001"]
