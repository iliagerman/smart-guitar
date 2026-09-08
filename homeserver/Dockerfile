FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

RUN uv pip install --system --no-cache boto3 "yt-dlp[default]==2026.8.19" requests pyyaml watchtower

WORKDIR /app
COPY youtube_downloader.py .

# Secrets are mounted at /app/config/secrets.yml at runtime
CMD ["python", "youtube_downloader.py"]
