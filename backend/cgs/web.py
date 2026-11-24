from django.conf import settings
from django.http import FileResponse, HttpResponse
from django.views.decorators.http import require_safe


@require_safe
def world_library(request, world_id=None):
    index = settings.FRONTEND_BUILD_DIR / "index.html"
    if not index.is_file():
        return HttpResponse(
            "The CGS frontend has not been built. See the local run instructions in README.md.",
            content_type="text/plain; charset=utf-8",
            status=503,
        )
    response = FileResponse(index.open("rb"), content_type="text/html; charset=utf-8")
    response["Cache-Control"] = "no-cache"
    return response
