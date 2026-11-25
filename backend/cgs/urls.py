from django.contrib import admin
from django.urls import path

from cgs.accounts import views as sessions
from cgs.web import world_library
from cgs.worlds import views as worlds
from cgs.worlds.draft_views import DraftEditsView, DraftView
from cgs.worlds.wiki_views import WikiChangeView, WikiSearchView, WikiView


urlpatterns = [
    path("", world_library, name="world-library"),
    path("worlds/<uuid:world_id>/", world_library, name="world-overview"),
    path("worlds/<uuid:world_id>/draft/", world_library, name="world-editor"),
    path("worlds/<uuid:world_id>/wiki/", world_library, name="world-wiki"),
    path("admin/", admin.site.urls),
    path("api/v1/session", sessions.SessionView.as_view(), name="session"),
    path("api/v1/session/login", sessions.LoginView.as_view(), name="login"),
    path("api/v1/session/logout", sessions.LogoutView.as_view(), name="logout"),
    path("api/v1/worlds", worlds.WorldListView.as_view(), name="worlds"),
    path("api/v1/worlds/<str:world_id>", worlds.WorldDetailView.as_view(), name="world"),
    path("api/v1/worlds/<str:world_id>/draft", DraftView.as_view(), name="draft"),
    path("api/v1/worlds/<str:world_id>/draft/edits", DraftEditsView.as_view(), name="draft-edits"),
    path("api/v1/worlds/<str:world_id>/draft/entries/<str:entry_id>", DraftView.as_view(), name="draft-entry"),
    path("api/v1/worlds/<str:world_id>/wiki", WikiView.as_view(), name="wiki"),
    path("api/v1/worlds/<str:world_id>/wiki/search", WikiSearchView.as_view(), name="wiki-search"),
    path("api/v1/worlds/<str:world_id>/wiki/timeline", WikiView.as_view(), {"timeline": True}, name="wiki-timeline"),
    path("api/v1/worlds/<str:world_id>/wiki/entries/<str:entry_id>", WikiView.as_view(), name="wiki-entry"),
    path("api/v1/worlds/<str:world_id>/wiki/changes", WikiChangeView.as_view(), name="wiki-change"),
]
