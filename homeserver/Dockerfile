FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir boto3 yt-dlp requests pyyaml watchtower

WORKDIR /app
COPY youtube_downloader.py .

# Secrets are mounted at /app/config/secrets.yml at runtime
CMD ["python", "youtube_downloader.py"]
