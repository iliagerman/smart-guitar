"""Cognito authentication service wrapping boto3 cognito-idp client."""

import logging

import boto3
from botocore.exceptions import ClientError

from guitar_player.config import Settings

logger = logging.getLogger(__name__)


class CognitoAuthError(Exception):
    """Mapped Cognito error with code and message."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


class CognitoAuthService:
    """High-level wrapper around AWS Cognito user-pool operations."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        cognito = settings.cognito
        self._user_pool_id = cognito.user_pool_id
        self._client_id = cognito.client_id

        kwargs: dict = {"region_name": cognito.region}
        if not settings.aws.use_iam_role:
            kwargs["aws_access_key_id"] = settings.aws.access_key
            kwargs["aws_secret_access_key"] = settings.aws.secret_key

        self._client = boto3.client("cognito-idp", **kwargs)

    def _handle_error(self, exc: ClientError) -> None:
        """Re-raise a ClientError as a CognitoAuthError."""
        code = exc.response["Error"]["Code"]
        message = exc.response["Error"]["Message"]
        raise CognitoAuthError(code, message) from exc

    def register(self, email: str, password: str) -> dict:
        """Sign up a new user. Returns user_sub, user_confirmed, and code_delivery info."""
        try:
            resp = self._client.sign_up(
                ClientId=self._client_id,
                Username=email,
                Password=password,
                UserAttributes=[{"Name": "email", "Value": email}],
            )
            return {
                "user_sub": resp["UserSub"],
                "user_confirmed": resp["UserConfirmed"],
                "code_delivery": resp.get("CodeDeliveryDetails"),
            }
        except ClientError as exc:
            self._handle_error(exc)

    def confirm(self, email: str, code: str) -> None:
        """Confirm a user's sign-up with the verification code."""
        try:
            self._client.confirm_sign_up(
                ClientId=self._client_id,
                Username=email,
                ConfirmationCode=code,
            )
        except ClientError as exc:
            self._handle_error(exc)

    def login(self, email: str, password: str) -> dict:
        """Authenticate with email/password and return tokens."""
        try:
            resp = self._client.initiate_auth(
                ClientId=self._client_id,
                AuthFlow="USER_PASSWORD_AUTH",
                AuthParameters={
                    "USERNAME": email,
                    "PASSWORD": password,
                },
            )
            result = resp["AuthenticationResult"]
            return {
                "access_token": result["AccessToken"],
                "id_token": result["IdToken"],
                "refresh_token": result["RefreshToken"],
                "expires_in": result["ExpiresIn"],
            }
        except ClientError as exc:
            self._handle_error(exc)

    def refresh_tokens(self, refresh_token: str) -> dict:
        """Exchange a refresh token for new access/id tokens."""
        try:
            resp = self._client.initiate_auth(
                ClientId=self._client_id,
                AuthFlow="REFRESH_TOKEN_AUTH",
                AuthParameters={
                    "REFRESH_TOKEN": refresh_token,
                },
            )
            result = resp["AuthenticationResult"]
            return {
                "access_token": result["AccessToken"],
                "id_token": result["IdToken"],
                "expires_in": result["ExpiresIn"],
            }
        except ClientError as exc:
            self._handle_error(exc)

    def resend_confirmation_code(self, email: str) -> dict:
        """Resend the sign-up confirmation code to the user's email."""
        try:
            resp = self._client.resend_confirmation_code(
                ClientId=self._client_id,
                Username=email,
            )
            return {"code_delivery": resp.get("CodeDeliveryDetails")}
        except ClientError as exc:
            self._handle_error(exc)

    # ── Admin helpers ─────────────────────────────────────────────

    def list_unconfirmed_users(self) -> list[dict]:
        """List all users with UNCONFIRMED status (paginated)."""
        users: list[dict] = []
        params: dict = {
            "UserPoolId": self._user_pool_id,
            "Filter": 'cognito:user_status = "UNCONFIRMED"',
            "Limit": 60,
        }
        while True:
            resp = self._client.list_users(**params)
            users.extend(resp.get("Users", []))
            token = resp.get("PaginationToken")
            if not token:
                break
            params["PaginationToken"] = token
        return users

    def admin_confirm_user(self, email: str) -> None:
        """Confirm a user without a verification code (admin API)."""
        self._client.admin_confirm_sign_up(
            UserPoolId=self._user_pool_id,
            Username=email,
        )

    def admin_delete_user(self, email: str) -> None:
        """Delete a user from the pool (admin API)."""
        self._client.admin_delete_user(
            UserPoolId=self._user_pool_id,
            Username=email,
        )
