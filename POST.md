# I Built an AI-Powered Music App and I'm Genuinely Excited About How It Came Together

As a guitarist, I always wanted a tool that could take any song and break it down for me — isolated guitar track, chords, lyrics, tabs — all in one place. So I built it.

**Guitar Player** takes any YouTube song and runs it through 4 ML models: Demucs separates the audio into stems (vocals, guitar, drums, bass), Autochord recognizes the chords, WhisperX transcribes lyrics with word-level timestamps, and basic-pitch generates guitar tabs. Everything plays back in sync — chords and lyrics scroll as the music plays.

The moment I first heard a clean isolated guitar track with the chords appearing in real time, I knew this was something special.

Here's how the architecture works:

![Architecture](docs/diagrams/post_architecture.png)

User hits "Process" → the FastAPI backend fires an **async Lambda** that orchestrates all 4 ML services in sequence. The frontend gets real-time progress via **SSE** — you watch each stage complete live. Bedrock Nova LLM parses YouTube titles into clean artist/song/genre metadata automatically.

The part I'm most proud of is the microservice design. Each ML model runs as its own independent HTTP service. This means I can scale stem separation (the heaviest workload) without touching anything else, swap out a model without redeploying the system, and isolate failures so one service going down doesn't cascade.

The entire infrastructure is Terraform — ECS Fargate for the API, Lambda for async processing, S3 + CloudFront for audio delivery, Cognito for auth, RDS PostgreSQL for data. Reproducible in a single `terraform apply`.

What started as a side project to learn guitar better turned into one of the most rewarding things I've built. There's something magical about muting the guitar track, seeing the chords scroll in real time, and playing along while the original singer is right there singing next to you.

If you're a musician who's ever wanted to isolate a guitar part, learn the chords, or just jam along — try it out: https://smart-guitar.com

#AWS #Serverless #MachineLearning #Architecture #Python #FastAPI #React #Music
