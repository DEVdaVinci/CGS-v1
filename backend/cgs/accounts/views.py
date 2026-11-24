from django.contrib.auth import authenticate, login, logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from cgs.api import CgsError, CgsView, StrictSerializer, TextField


class Credentials(StrictSerializer):
    username = TextField(max_length=150)
    password = TextField(max_length=1024)


def session_state(request):
    account = request.user
    state = {"authenticated": account.is_authenticated, "csrf_token": get_token(request)}
    if account.is_authenticated:
        state.update(
            account_id=str(account.pk),
            display_name=(account.get_full_name() or account.get_username())[:100],
        )
    return state


class SessionView(CgsView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(session_state(request))


@method_decorator(csrf_protect, name="dispatch")
class LoginView(CgsView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        credentials = Credentials(data=request.data)
        credentials.is_valid(raise_exception=True)
        account = authenticate(request, **credentials.validated_data)
        if account is None:
            raise CgsError(403, "LOGIN_FAILED", "Invalid username or password.")
        login(request, account)
        return Response(session_state(request))


class LogoutView(CgsView):
    def post(self, request):
        logout(request)
        return Response(status=204)
