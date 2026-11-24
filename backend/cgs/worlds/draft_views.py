from rest_framework import serializers
from rest_framework.response import Response

from cgs.api import CgsView, parse_id

from .drafts import apply_draft_edits, read_draft


class RevisionQuery(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0, max_value=9007199254740991, required=False)


class DraftView(CgsView):
    def get(self, request, world_id, entry_id=None):
        query = RevisionQuery(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        return Response(read_draft(
            parse_id(world_id, "world_id"),
            request.user.pk,
            query.validated_data.get("revision"),
            parse_id(entry_id, "entry_id") if entry_id is not None else None,
        ))


class DraftEditsView(CgsView):
    def post(self, request, world_id):
        return Response(apply_draft_edits(
            parse_id(world_id, "world_id"),
            request.user.pk,
            parse_id(request.headers.get("Idempotency-Key"), "Idempotency-Key"),
            request.data,
        ))
