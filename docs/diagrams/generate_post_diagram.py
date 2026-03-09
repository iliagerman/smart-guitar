"""Generate a single clean architecture diagram for LinkedIn post."""
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Fargate, Lambda
from diagrams.aws.database import RDS
from diagrams.aws.storage import S3
from diagrams.aws.network import CloudFront
from diagrams.aws.security import Cognito
from diagrams.aws.integration import SQS
from diagrams.aws.ml import Bedrock
from diagrams.aws.general import User
from diagrams.onprem.compute import Server
from diagrams.programming.framework import React

with Diagram(
    "",
    filename="post_architecture",
    show=False,
    direction="TB",
    graph_attr={
        "fontsize": "14",
        "bgcolor": "white",
        "pad": "0.3",
        "ranksep": "0.8",
        "nodesep": "0.5",
    },
):
    user = User("User")

    frontend = React("React SPA")
    cdn = CloudFront("CloudFront")

    with Cluster("API Layer\n(ECS Fargate — scales to zero)"):
        api = Fargate("FastAPI")

    with Cluster("Serverless Workers\n(pay-per-invocation)"):
        orchestrator = Lambda("Job\nOrchestrator")
        stitch = Lambda("Audio\nMerge")

    with Cluster("ML Microservices\n(independent scaling)"):
        demucs = Server("Stem\nSeparation")
        chords = Server("Chord\nRecognition")
        lyrics = Server("Lyrics\nTranscription")
        tabs = Server("Tab\nGeneration")

    with Cluster("Managed Data\n(zero ops)"):
        db = RDS("PostgreSQL")
        storage = S3("S3")

    cognito = Cognito("Cognito")
    bedrock = Bedrock("Bedrock\nLLM")
    sqs = SQS("SQS")

    user >> cdn >> frontend
    frontend >> api

    api >> cognito
    api >> bedrock
    api >> db
    api >> Edge(label="async") >> orchestrator

    orchestrator >> demucs
    orchestrator >> chords
    orchestrator >> lyrics
    orchestrator >> tabs
    orchestrator >> stitch

    demucs >> storage
    chords >> storage
    lyrics >> storage
    tabs >> storage

    orchestrator >> db
    api >> sqs

print("Post diagram generated!")
