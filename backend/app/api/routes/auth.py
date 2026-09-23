from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status

from app.api.deps import CurrentSession, CurrentUser, DbSession, get_optional_session
from app.core import rate_limit
from app.core.config import get_settings
from app.core.csrf import CSRF_HEADER
from app.core.security import PASSWORD_MIN_LENGTH, generate_token
from app.models import UserSession
from app.schemas.auth import (
    AuthConfigResponse,
    ChangePasswordRequest,
    CsrfResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    UserPublic,
)
from app.services import auth as auth_service
from app.services.email import send_email

router = APIRouter(prefix="/auth", tags=["auth"])

INVALID_CREDENTIALS = "Invalid email/username or password."
FORGOT_PASSWORD_MESSAGE = "If an account exists for that email, a password reset link has been sent."


# --- Cookie helpers ------------------------------------------------------------------


def _set_session_cookie(response: Response, token: str, max_age: int | None) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=max_age,
        httponly=True,  # Not readable by JavaScript: XSS can't steal the session.
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        settings.session_cookie_name, path="/", httponly=True, secure=settings.cookie_secure, samesite="lax"
    )


def _set_csrf_cookie(response: Response, token: str) -> None:
    """Issue a CSRF token as a cookie and mirror it in a header so the SPA can pick it up."""
    settings = get_settings()
    response.headers[CSRF_HEADER] = token
    response.set_cookie(
        settings.csrf_cookie_name,
        token,
        httponly=False,  # The frontend echoes it back in the X-CSRF-Token header.
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def _start_session(request: Request, response: Response, db, user, remember_me: bool) -> None:
    new = auth_service.create_session(
        db,
        user=user,
        remember_me=remember_me,
        user_agent=request.headers.get("user-agent"),
        ip_address=rate_limit.client_ip(request),
    )
    _set_session_cookie(response, new.token, new.max_age_seconds)
    # Rotate the CSRF token whenever the authentication state changes.
    _set_csrf_cookie(response, generate_token())


# --- Public endpoints ----------------------------------------------------------------


@router.get("/csrf", response_model=CsrfResponse)
def get_csrf_token(request: Request, response: Response) -> CsrfResponse:
    """Return the CSRF token for this browser, issuing one if needed."""
    token = request.cookies.get(get_settings().csrf_cookie_name)
    if not token or len(token) > 100:
        token = generate_token()
    _set_csrf_cookie(response, token)
    response.headers["Cache-Control"] = "no-store"
    return CsrfResponse(csrf_token=token)


@router.get("/config", response_model=AuthConfigResponse)
def get_auth_config() -> AuthConfigResponse:
    settings = get_settings()
    return AuthConfigResponse(
        registration_enabled=settings.registration_enabled, password_min_length=PASSWORD_MIN_LENGTH
    )


@router.post("/register", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, response: Response, db: DbSession) -> UserPublic:
    if not get_settings().registration_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Registration is disabled.")
    rate_limit.enforce("register:ip", rate_limit.client_ip(request), rate_limit.REGISTER_PER_IP)
    try:
        user = auth_service.register_user(
            db,
            name=payload.name,
            username=payload.username,
            email=payload.email,
            password=payload.password.get_secret_value(),
        )
    except auth_service.DuplicateAccountError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"field": exc.field, "message": str(exc)}
        ) from None
    _start_session(request, response, db, user, remember_me=False)
    return UserPublic.model_validate(user)


@router.post("/login", response_model=UserPublic)
def login(payload: LoginRequest, request: Request, response: Response, db: DbSession) -> UserPublic:
    ip = rate_limit.client_ip(request)
    rate_limit.enforce("login:ip", ip, rate_limit.LOGIN_PER_IP)
    rate_limit.enforce("login:account", f"{ip}|{payload.identifier.lower()}", rate_limit.LOGIN_PER_ACCOUNT)

    user = auth_service.authenticate(db, identifier=payload.identifier, password=payload.password.get_secret_value())
    if user is None:
        # Same message whether the account is unknown, disabled, or the password is wrong.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)
    _start_session(request, response, db, user, remember_me=payload.remember_me)
    return UserPublic.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response, db: DbSession, session: Annotated[UserSession | None, Depends(get_optional_session)]
) -> Response:
    if session is not None:
        auth_service.revoke_session(db, session)
    _clear_session_cookie(response)
    _set_csrf_cookie(response, generate_token())
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/forgot-password", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    payload: ForgotPasswordRequest, request: Request, background: BackgroundTasks, db: DbSession
) -> MessageResponse:
    ip = rate_limit.client_ip(request)
    rate_limit.enforce("forgot:ip", ip, rate_limit.FORGOT_PER_IP)
    rate_limit.enforce("forgot:email", payload.email, rate_limit.FORGOT_PER_EMAIL)

    email = auth_service.create_password_reset(db, email=payload.email, requested_ip=ip)
    if email is not None:
        # Sent after the response so delivery time can't reveal whether the account exists.
        background.add_task(send_email, email)
    return MessageResponse(message=FORGOT_PASSWORD_MESSAGE)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(payload: ResetPasswordRequest, request: Request, db: DbSession) -> Response:
    rate_limit.enforce("reset:ip", rate_limit.client_ip(request), rate_limit.RESET_PER_IP)
    try:
        auth_service.reset_password(db, token=payload.token, new_password=payload.new_password.get_secret_value())
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_session_cookie(response)
    return response


# --- Authenticated endpoints -----------------------------------------------------------


@router.get("/me", response_model=UserPublic)
def me(user: CurrentUser, response: Response) -> UserPublic:
    response.headers["Cache-Control"] = "no-store"
    return UserPublic.model_validate(user)


@router.post("/change-password", response_model=MessageResponse)
def change_password(
    payload: ChangePasswordRequest, response: Response, user: CurrentUser, session: CurrentSession, db: DbSession
) -> MessageResponse:
    rate_limit.enforce("change-password:user", str(user.id), rate_limit.CHANGE_PASSWORD_PER_USER)
    try:
        token = auth_service.change_password(
            db,
            user=user,
            current_session=session,
            current=payload.current_password.get_secret_value(),
            new=payload.new_password.get_secret_value(),
        )
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    remember = session.idle_timeout_seconds >= get_settings().session_remember_me_days * 86400
    _set_session_cookie(
        response, token, int((session.expires_at - auth_service.utcnow()).total_seconds()) if remember else None
    )
    _set_csrf_cookie(response, generate_token())
    return MessageResponse(message="Password changed. Other devices have been signed out.")
