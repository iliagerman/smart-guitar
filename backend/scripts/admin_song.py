"""Repair one production song or inspect its processing job."""

import argparse
import uuid
from pathlib import Path

import httpx
import yaml

from guitar_player.schemas.admin import AdminSongResponse
from guitar_player.schemas.job import JobResponse


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("heal", "job"))
    parser.add_argument("id", type=uuid.UUID)
    args = parser.parse_args()
    secrets_path = Path(__file__).resolve().parents[2] / "prod.secrets.yml"
    config = yaml.safe_load(secrets_path.read_text())
    token = config["admin"]["api-key"]
    if not isinstance(token, str) or not token.strip():
        raise ValueError("Missing production admin API key")
    with httpx.Client(
        base_url="https://api.smart-guitar.com/api/v1/admin/",
        headers={"Authorization": f"Bearer {token}"},
        timeout=180,
    ) as client:
        if args.action == "heal":
            response = client.post(f"songs/{args.id}/heal")
            model = AdminSongResponse
        else:
            response = client.get(f"jobs/{args.id}")
            model = JobResponse
        response.raise_for_status()
        print(model.model_validate(response.json()).model_dump_json(indent=2))


if __name__ == "__main__":
    main()
