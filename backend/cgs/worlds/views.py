import unicodedata

from django.core import signing
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from cgs.api import CgsView, StrictSerializer, TextField, parse_id

from . import services


class WorldInput(StrictSerializer):
    name = TextField(max_length=100)

    def validate_name(self, value):
        name = unicodedata.normalize("NFC", value)
        if len(name) > 100:
            raise ValidationError("Ensure the normalized name has at most 100 characters.")
        return name


class WorldListFilters(serializers.Serializer):
    limit = serializers.IntegerField(min_value=1, max_value=100, default=25)
    cursor = TextField(max_length=1000, required=False)
    q = TextField(max_length=100, required=False)


CURSOR_SALT = "cgs.worlds.list"


def cursor_after(token, scope):
    try:
        payload = signing.loads(token, salt=CURSOR_SALT)
    except signing.BadSignature as exc:
        raise ValidationError({"cursor": "Invalid world cursor."}) from exc
    if not isinstance(payload, dict) or payload.get("scope") != scope:
        raise ValidationError({"cursor": "Invalid world cursor."})
    return parse_id(payload.get("after"), "cursor")


class WorldListView(CgsView):
    def get(self, request):
        filters = WorldListFilters(data=request.query_params.dict())
        filters.is_valid(raise_exception=True)
        limit = filters.validated_data["limit"]
        query = filters.validated_data.get("q")
        scope = {"account": str(request.user.pk), "q": query}

        memberships = services.visible_worlds(request.user.pk)
        if query is not None:
            memberships = memberships.filter(world__title__icontains=query)
        if cursor := filters.validated_data.get("cursor"):
            memberships = memberships.filter(world_id__gt=cursor_after(cursor, scope))

        page = list(memberships.order_by("world_id")[: limit + 1])
        next_cursor = None
        if len(page) > limit:
            page.pop()
            next_cursor = signing.dumps(
                {"scope": scope, "after": str(page[-1].world_id)}, salt=CURSOR_SALT, compress=True,
            )
        return Response({"items": [services.summarize_world(item) for item in page], "next_cursor": next_cursor})

    def post(self, request):
        request_key = parse_id(request.headers.get("Idempotency-Key"), "Idempotency-Key")
        form = WorldInput(data=request.data)
        form.is_valid(raise_exception=True)
        status, result = services.create_world(request.user.pk, request_key, form.validated_data["name"])
        return Response(result, status=status)


class WorldDetailView(CgsView):
    def get(self, request, world_id):
        membership = services.get_membership(request.user.pk, parse_id(world_id, "world_id"))
        return Response(services.summarize_world(membership))
