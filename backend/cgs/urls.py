from django.contrib import admin
from django.urls import path

from cgs.accounts import views as sessions
from cgs.worlds import views as worlds


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/session", sessions.SessionView.as_view(), name="session"),
    path("api/v1/session/login", sessions.LoginView.as_view(), name="login"),
    path("api/v1/session/logout", sessions.LogoutView.as_view(), name="logout"),
    path("api/v1/worlds", worlds.WorldListView.as_view(), name="worlds"),
    path("api/v1/worlds/<str:world_id>", worlds.WorldDetailView.as_view(), name="world"),
]
