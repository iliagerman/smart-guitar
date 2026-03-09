"""Generate architecture diagrams for the Guitar Player application."""
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import ECS, Lambda, Fargate
from diagrams.aws.database import RDS
from diagrams.aws.storage import S3
from diagrams.aws.network import CloudFront, ELB
from diagrams.aws.security import Cognito
from diagrams.aws.integration import SQS, Eventbridge
from diagrams.aws.management import Cloudwatch
from diagrams.aws.ml import Bedrock, Transcribe
from diagrams.aws.general import User, Users
from diagrams.onprem.client import Client
from diagrams.onprem.compute import Server
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.monitoring import Grafana
from diagrams.onprem.network import Nginx
from diagrams.programming.framework import React, FastAPI


# ─── Diagram 1: High-Level Architecture ───────────────────────────────────────

with Diagram(
    "Guitar Player — High-Level Architecture",
    filename="high_level_architecture",
    show=False,
    direction="TB",
    graph_attr={"fontsize": "20", "bgcolor": "white", "pad": "0.5"},
):
    user = User("User")

    with Cluster("Frontend — React SPA"):
        frontend = React("Vite + React 19\nTypeScript")

    with Cluster("Backend — FastAPI"):
        api = FastAPI("REST API")

        with Cluster("Services"):
            song_svc = Server("Song\nService")
            job_svc = Server("Job\nService")
            auth_svc = Server("Auth\nService")

    with Cluster("Lambda Workers"):
        orchestrator = Lambda("Job\nOrchestrator")
        stitcher = Lambda("Vocals+Guitar\nStitch")
        sweeper = Lambda("Stale Job\nSweeper")

    with Cluster("ML Microservices"):
        demucs = Server("Demucs\nStem Separation")
        chords = Server("Autochord\nChord Recognition")
        lyrics = Server("WhisperX\nLyrics")
        tabs = Server("Basic-Pitch\nTabs")

    with Cluster("Data Layer"):
        db = RDS("PostgreSQL")
        storage = S3("Audio & Stems\nStorage")

    with Cluster("External Services"):
        cognito = Cognito("Cognito\nAuth")
        bedrock = Bedrock("Nova Lite\nLLM")
        cdn = CloudFront("CloudFront\nCDN")

    # Connections
    user >> Edge(label="HTTPS") >> frontend
    frontend >> Edge(label="REST + JWT") >> api

    api >> song_svc
    api >> job_svc
    api >> auth_svc

    auth_svc >> cognito
    song_svc >> bedrock
    song_svc >> db
    song_svc >> storage

    job_svc >> Edge(label="async invoke") >> orchestrator
    orchestrator >> demucs
    orchestrator >> chords
    orchestrator >> lyrics
    orchestrator >> tabs
    orchestrator >> stitcher
    orchestrator >> db

    demucs >> storage
    chords >> storage
    lyrics >> storage
    tabs >> storage

    storage >> cdn >> frontend
    sweeper >> db


# ─── Diagram 2: Job Processing Pipeline ──────────────────────────────────────

with Diagram(
    "Guitar Player — Job Processing Pipeline",
    filename="job_processing_pipeline",
    show=False,
    direction="LR",
    graph_attr={"fontsize": "20", "bgcolor": "white", "pad": "0.5"},
):
    user = User("User")
    frontend = React("Frontend")

    with Cluster("Backend API"):
        api = FastAPI("FastAPI")
        db = RDS("PostgreSQL")

    with Cluster("Async Processing"):
        orchestrator = Lambda("Job Orchestrator\nLambda")

        with Cluster("Step 1: Stem Separation"):
            demucs = Server("Demucs")

        with Cluster("Step 2: Chord Recognition"):
            chords = Server("Autochord")

        with Cluster("Step 3: Lyrics"):
            lyrics_svc = Server("WhisperX")

        with Cluster("Step 4: Tabs"):
            tabs_svc = Server("Basic-Pitch")

        stitcher = Lambda("Vocals+Guitar\nStitch")

    storage = S3("S3 Storage")

    # Flow
    user >> Edge(label="1. Click Process") >> frontend
    frontend >> Edge(label="2. POST /jobs") >> api
    api >> Edge(label="3. Create Job\n(PENDING)") >> db
    api >> Edge(label="4. Async Invoke") >> orchestrator

    orchestrator >> Edge(label="5. Separate", color="blue") >> demucs
    demucs >> Edge(color="blue") >> storage

    orchestrator >> Edge(label="6. Chords", color="green") >> chords
    chords >> Edge(color="green") >> storage

    orchestrator >> Edge(label="7. Lyrics", color="orange") >> lyrics_svc
    lyrics_svc >> Edge(color="orange") >> storage

    orchestrator >> Edge(label="8. Tabs", color="purple") >> tabs_svc
    tabs_svc >> Edge(color="purple") >> storage

    orchestrator >> Edge(label="9. Merge") >> stitcher
    stitcher >> storage

    orchestrator >> Edge(label="10. COMPLETED", style="bold") >> db

    frontend << Edge(label="SSE events", style="dashed", color="red") << api


# ─── Diagram 3: AWS Infrastructure ───────────────────────────────────────────

with Diagram(
    "Guitar Player — AWS Infrastructure",
    filename="aws_infrastructure",
    show=False,
    direction="TB",
    graph_attr={"fontsize": "20", "bgcolor": "white", "pad": "0.5"},
):
    users = Users("Users")
    cdn = CloudFront("CloudFront CDN")

    with Cluster("AWS Cloud"):
        with Cluster("VPC"):
            with Cluster("Public Subnet"):
                lb = ELB("ALB")

            with Cluster("Private Subnet — Compute"):
                with Cluster("ECS Fargate"):
                    ecs = Fargate("Backend API\nContainers")

            with Cluster("Private Subnet — Data"):
                rds = RDS("PostgreSQL\nRDS")

        with Cluster("Serverless"):
            job_lambda = Lambda("Job\nOrchestrator")
            stitch_lambda = Lambda("Vocals+Guitar\nStitch")
            sweep_lambda = Lambda("Stale Job\nSweeper")
            cleanup_lambda = Lambda("User\nCleanup")

        with Cluster("Storage"):
            audio_s3 = S3("Audio\nBucket")
            frontend_s3 = S3("Frontend\nSPA")

        with Cluster("Security & Auth"):
            cognito = Cognito("Cognito\nUser Pool")

        with Cluster("Messaging"):
            sqs = SQS("YouTube\nDownload Queue")

        with Cluster("Monitoring"):
            cw = Cloudwatch("CloudWatch\nLogs")

    with Cluster("On-Premises"):
        homeserver = Server("Homeserver\nYT Downloader")
        grafana = Grafana("Grafana\nDashboards")

    # Connections
    users >> cdn
    cdn >> frontend_s3
    cdn >> lb

    lb >> ecs
    ecs >> rds
    ecs >> audio_s3
    ecs >> cognito
    ecs >> sqs
    ecs >> Edge(label="async") >> job_lambda

    job_lambda >> rds
    job_lambda >> audio_s3
    job_lambda >> stitch_lambda
    sweep_lambda >> rds
    cleanup_lambda >> rds

    sqs >> homeserver
    homeserver >> audio_s3

    ecs >> cw
    job_lambda >> cw
    cw >> grafana

    audio_s3 >> cdn


print("All diagrams generated successfully!")
