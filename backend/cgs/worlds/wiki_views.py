from rest_framework.response import Response

from cgs.api import CgsView, parse_id

from .wiki_reads import read_wiki, search_wiki
from .wiki_schema import WikiLocationQuery, WikiSearchQuery, WikiWriteInput
from .wiki_writes import save_wiki_change


class WikiView(CgsView):
    def get(self, request, world_id, entry_id=None, timeline=False):
        query = WikiLocationQuery(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        return Response(read_wiki(
            parse_id(world_id, "world_id"), request.user.pk, query.validated_data["at"],
            observer_id=query.validated_data.get("view_as"),
            entry_id=parse_id(entry_id, "entry_id") if entry_id is not None else None,
            timeline=timeline,
        ))


class WikiSearchView(CgsView):
    def get(self, request, world_id):
        query = WikiSearchQuery(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        return Response(search_wiki(
            parse_id(world_id, "world_id"), request.user.pk, query.validated_data["q"],
        ))


class WikiChangeView(CgsView):
    def post(self, request, world_id):
        request_key = parse_id(request.headers.get("Idempotency-Key"), "Idempotency-Key")
        form = WikiWriteInput(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(save_wiki_change(
            parse_id(world_id, "world_id"), request.user.pk, request_key, form.validated_data,
        ))
