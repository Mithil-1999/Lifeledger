"""Request/response schemas for authentication.

Passwords use `SecretStr`, so they are masked in reprs, logs and tracebacks.
"""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    SecretStr,
    StringConstraints,
    model_validator,
)

from app.core.security import PASSWORD_MAX_LENGTH, password_policy_errors


def _lower(value: str) -> str:
    return value.lower()


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Username = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=32, pattern=r"^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$"),
    AfterValidator(_lower),
]
Email = Annotated[EmailStr, Field(max_length=254), AfterValidator(_lower)]
# Upper bound on every password field prevents hashing-cost abuse.
Password = Annotated[SecretStr, Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)]


def _check_strength(password: SecretStr, **context: str) -> None:
    errors = password_policy_errors(password.get_secret_value(), **context)
    if errors:
        raise ValueError(" ".join(errors))


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    username: Username
    email: Email
    password: Password
    confirm_password: Password

    @model_validator(mode="after")
    def _validate_passwords(self) -> "RegisterRequest":
        if self.password.get_secret_value() != self.confirm_password.get_secret_value():
            raise ValueError("Passwords do not match.")
        _check_strength(self.password, username=self.username, email=self.email, name=self.name)
        return self


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    identifier: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=254)] = Field(
        description="Email address or username"
    )
    password: Password
    remember_me: bool = False


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: Password
    new_password: Password
    confirm_new_password: Password

    @model_validator(mode="after")
    def _validate_passwords(self) -> "ChangePasswordRequest":
        new = self.new_password.get_secret_value()
        if new != self.confirm_new_password.get_secret_value():
            raise ValueError("New passwords do not match.")
        if new == self.current_password.get_secret_value():
            raise ValueError("New password must be different from the current password.")
        return self


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Email


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: Annotated[str, StringConstraints(min_length=20, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")]
    new_password: Password
    confirm_new_password: Password

    @model_validator(mode="after")
    def _validate_passwords(self) -> "ResetPasswordRequest":
        if self.new_password.get_secret_value() != self.confirm_new_password.get_secret_value():
            raise ValueError("Passwords do not match.")
        return self


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    username: str
    email: str
    status: str
    created_at: datetime
    last_login_at: datetime | None


class CsrfResponse(BaseModel):
    csrf_token: str


class AuthConfigResponse(BaseModel):
    registration_enabled: bool
    password_min_length: int


class MessageResponse(BaseModel):
    message: str
