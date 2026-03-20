"""
애플리케이션 공통 오류 정의.

ErrCode: Java enum 방식 — HTTP status + 기본 메시지를 한 곳에서 관리.
AppException: 라우터/서비스 어디서든 raise하는 단일 예외 타입.
main.py의 global handler가 JSONResponse로 변환한다.

사용 예:
    ErrCode.CHAT_NOT_FOUND.raise_it()
    ErrCode.INSUFFICIENT_ROLE.raise_it("editor 이상만 가능합니다.")
    raise ErrCode.ALREADY_MEMBER.exc()
"""
from __future__ import annotations
from enum import Enum


class ErrCode(Enum):
    # ── 인증 (401) ────────────────────────────────────────────────────────────
    NOT_AUTHENTICATED   = (401, "인증이 필요합니다.")
    INVALID_TOKEN       = (401, "유효하지 않은 토큰입니다.")
    TOKEN_EXPIRED       = (401, "토큰이 만료되었습니다.")
    USER_SUSPENDED      = (401, "정지된 계정입니다.")

    # ── 권한 (403) ────────────────────────────────────────────────────────────
    FORBIDDEN           = (403, "접근 권한이 없습니다.")
    INSUFFICIENT_ROLE   = (403, "이 작업에 필요한 권한이 없습니다.")
    OAUTH_DISABLED      = (403, "해당 OAuth 제공자가 비활성화되어 있습니다.")

    # ── 리소스 없음 (404) ──────────────────────────────────────────────────────
    NOT_FOUND           = (404, "리소스를 찾을 수 없습니다.")
    CHAT_NOT_FOUND      = (404, "채팅을 찾을 수 없습니다.")
    FOLDER_NOT_FOUND    = (404, "폴더를 찾을 수 없습니다.")
    USER_NOT_FOUND      = (404, "유저를 찾을 수 없습니다.")
    MEMBER_NOT_FOUND    = (404, "멤버를 찾을 수 없습니다.")
    WORKSPACE_NOT_FOUND = (404, "워크스페이스 아이템을 찾을 수 없습니다.")
    KNOWLEDGE_NOT_FOUND = (404, "지식 아이템을 찾을 수 없습니다.")

    # ── 충돌 (409) ────────────────────────────────────────────────────────────
    ALREADY_MEMBER      = (409, "이미 이 채팅의 멤버입니다.")
    OAUTH_CONFLICT      = (409, "이 이메일은 다른 OAuth 제공자와 연결되어 있습니다.")
    CREATE_CONFLICT     = (409, "동시 요청으로 충돌이 발생했습니다. 다시 시도해주세요.")

    # ── 잘못된 요청 (400) ─────────────────────────────────────────────────────
    SELF_INVITE         = (400, "자기 자신은 초대할 수 없습니다.")
    CANNOT_CHANGE_OWNER = (400, "오너의 역할은 변경할 수 없습니다.")
    CANNOT_ASSIGN_OWNER = (400, "owner 역할은 직접 부여할 수 없습니다.")
    CANNOT_KICK_OWNER   = (400, "오너는 추방할 수 없습니다.")
    INVALID_NAME        = (422, "이름을 입력해주세요.")

    # ── 파일 (413 / 415) ──────────────────────────────────────────────────────
    FILE_TOO_LARGE      = (413, "파일 크기 제한을 초과했습니다.")
    UNSUPPORTED_TYPE    = (415, "지원하지 않는 파일 형식입니다.")

    def __init__(self, status: int, message: str) -> None:
        self.status = status
        self.message = message

    def exc(self, detail: str | None = None) -> "AppException":
        """예외 인스턴스 생성 (raise 없이)."""
        return AppException(self, detail)

    def raise_it(self, detail: str | None = None) -> None:
        """즉시 raise."""
        raise self.exc(detail)


class AppException(Exception):
    """서비스/라우터 전 계층에서 사용하는 단일 비즈니스 예외."""

    def __init__(self, code: ErrCode, detail: str | None = None) -> None:
        self.code = code
        self.detail = detail or code.message
        super().__init__(self.detail)
