from collections.abc import Mapping
import re
from uuid import UUID

from django.db import InterfaceError, OperationalError
from django.http import JsonResponse
from django.utils.cache import add_never_cache_headers
from django.views.csrf import csrf_failure as django_csrf_failure
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import APIException, NotAuthenticated, PermissionDenied, ValidationError
from rest_framework.views import APIView, exception_handler


class CgsError(APIException):
    def __init__(self, status, code, message, field_errors=(), *, conflict_revision=None):
        self.status_code = status
        self.envelope = error_body(code, message, field_errors)
        if conflict_revision is not None:
            self.envelope["conflict_revision"] = conflict_revision
        super().__init__(message, code=code)


def error_body(code, message, field_errors=()):
    return {"code": code, "message": message, "field_errors": list(field_errors)}


def sign_in_required():
    return CgsError(401, "SIGN_IN_REQUIRED", "Sign in to continue.")


def resource_unavailable():
    return CgsError(404, "RESOURCE_UNAVAILABLE", "Resource unavailable.")


class CgsSessionAuthentication(SessionAuthentication):
    def authenticate_header(self, request):
        return "Session"

    def enforce_csrf(self, request):
        try:
            super().enforce_csrf(request._request)
        except PermissionDenied as exc:
            raise CgsError(403, "CSRF_FAILED", "The CSRF token is invalid.") from exc


def csrf_failure(request, reason=""):
    if not request.path_info.startswith("/api/v1/"):
        return django_csrf_failure(request, reason=reason)
    response = JsonResponse(error_body("CSRF_FAILED", "The CSRF token is invalid."), status=403)
    add_never_cache_headers(response)
    return response


def handle_api_exception(exc, context):
    if isinstance(exc, (OperationalError, InterfaceError)):
        exc = CgsError(503, "DEPENDENCY_UNAVAILABLE", "The database is temporarily unavailable.")
    elif isinstance(exc, NotAuthenticated):
        # Keep headers added by DRF when it prepares the original exception.
        response = exception_handler(exc, context)
        response.data = sign_in_required().envelope
        return response

    response = exception_handler(exc, context)
    if response is None:
        return None
    if isinstance(exc, CgsError):
        response.data = exc.envelope
    elif isinstance(exc, ValidationError):
        issues = exc.detail if isinstance(exc.detail, Mapping) else {"Request": exc.detail}
        fields = [
            {"code": "INVALID_INPUT", "message": f"{name}: {message}"[:400]}
            for name, messages in issues.items()
            for message in (messages if isinstance(messages, list) else [messages])
        ]
        response.data = error_body("INVALID_INPUT", "Check the submitted values.", fields[:100])
    elif response.status_code == 404:
        response.data = resource_unavailable().envelope
    elif response.status_code == 403:
        response.data = error_body("ACTION_UNAVAILABLE", "Action unavailable.")
    else:
        response.data = error_body("INVALID_INPUT", str(exc.detail)[:400])
    return response


class CgsView(APIView):
    authentication_classes = [CgsSessionAuthentication]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        add_never_cache_headers(response)
        return response


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, Mapping) and data.keys() - self.fields.keys():
            raise ValidationError({"non_field_errors": ["The request contains unsupported fields."]})
        return super().to_internal_value(data)


class TextField(serializers.CharField):
    def __init__(self, **kwargs):
        super().__init__(trim_whitespace=False, **kwargs)

    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


ID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def parse_id(value, field):
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise ValidationError({field: "Provide a lowercase, hyphenated UUID."})
    return UUID(value)
