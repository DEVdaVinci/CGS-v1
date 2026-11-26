from contextlib import suppress
from datetime import timedelta
from functools import partial
from hashlib import sha256

from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone
from PIL import Image

from cgs.api import CgsError, resource_unavailable

from .drafts import _scoped_read
from .models import WikiEntry, WikiMapImage, WikiMapPin, WikiWorld, World
from .wiki import entry_for, reject, wiki_access


MAX_MAP_BYTES = 20 * 1024 * 1024
MAX_MAP_PIXELS = 32_000_000
UPLOAD_LIFETIME = timedelta(days=7)
IMAGE_TYPES = {"PNG": ("image/png", "png"), "JPEG": ("image/jpeg", "jpg")}


def _image_details(upload):
    if upload.size > MAX_MAP_BYTES:
        reject("MAP_IMAGE_SIZE", "Choose an image of 20 MiB or less.")
    try:
        with Image.open(upload, formats=list(IMAGE_TYPES)) as image:
            if image.format not in IMAGE_TYPES or getattr(image, "is_animated", False):
                reject("MAP_IMAGE_FORMAT", "Choose a still PNG or JPEG image.")
            content_type, suffix = IMAGE_TYPES[image.format]
            width, height = image.size
            if width * height > MAX_MAP_PIXELS:
                reject("MAP_IMAGE_DIMENSIONS", "Choose an image of 32 megapixels or less.")
            image.verify()
        upload.seek(0)
        with Image.open(upload, formats=list(IMAGE_TYPES)) as image:
            image.load()
            rotated = image.getexif().get(274) in (5, 6, 7, 8)
    except (OSError, Image.DecompressionBombError, SyntaxError, ValueError) as exc:
        raise CgsError(422, "VALIDATION_FAILED", "Review the Wiki change.", [{
            "code": "MAP_IMAGE_FORMAT", "message": "Choose a complete PNG or JPEG image.",
        }]) from exc
    if rotated:
        width, height = height, width
    return content_type, suffix, width, height


def _prune_uploads(wiki):
    expired = WikiMapImage.objects.filter(
        wiki=wiki, entry__isnull=True, created_at__lt=timezone.now() - UPLOAD_LIFETIME,
    )
    for storage_key in expired.values_list("storage_key", flat=True):
        transaction.on_commit(partial(default_storage.delete, storage_key), robust=True)
    expired.delete()


def stage_map_image(world_id, account_id, request_key, upload):
    wiki_access(world_id, account_id, writing=True)
    content_type, suffix, width, height = _image_details(upload)
    checksum = sha256()
    for chunk in upload.chunks():
        checksum.update(chunk)
    upload.seek(0)

    storage_key = None
    try:
        with transaction.atomic():
            world = World.objects.select_for_update().filter(pk=world_id).first()
            if world is None:
                raise resource_unavailable()
            wiki_access(world_id, account_id, writing=True)
            wiki, _ = WikiWorld.objects.get_or_create(world=world)
            _prune_uploads(wiki)
            staged = WikiMapImage.objects.filter(wiki=wiki, uploaded_by_id=account_id, request_key=request_key).first()
            digest = checksum.hexdigest()
            if staged is not None:
                if staged.digest != digest:
                    raise CgsError(409, "KEY_REUSED", "This upload key was used for a different image.")
                return staged.pk
            staged = WikiMapImage(
                wiki=wiki, uploaded_by_id=account_id, request_key=request_key, digest=digest,
                content_type=content_type, width=width, height=height,
            )
            storage_key = f"wiki-maps/{staged.pk}.{suffix}"
            storage_key = default_storage.save(storage_key, upload)
            staged.storage_key = storage_key
            staged.save(force_insert=True)
            return staged.pk
    except Exception as exc:
        if storage_key is not None:
            with suppress(OSError):
                default_storage.delete(storage_key)
        if isinstance(exc, OSError):
            raise CgsError(503, "MAP_STORAGE_UNAVAILABLE", "The map image could not be stored.") from exc
        raise


def attach_map_image(entry, account_id, upload_id):
    staged = WikiMapImage.objects.filter(
        pk=upload_id, wiki_id=entry.wiki_id, uploaded_by_id=account_id, entry__isnull=True,
        created_at__gte=timezone.now() - UPLOAD_LIFETIME,
    ).first()
    if staged is None:
        reject("INVALID_MAP_UPLOAD", "Select and upload the map image again.")
    if WikiMapImage.objects.filter(entry=entry).exists():
        reject("MAP_IMAGE_EXISTS", "This map already has an image.")
    staged.entry = entry
    staged.save(update_fields=["entry"])


def _require_image_map(wiki, map_id):
    entry = entry_for(wiki, map_id, WikiEntry.Kind.MAP)
    if not WikiMapImage.objects.filter(entry=entry).exists():
        reject("MISSING_MAP_IMAGE", "Attach an image before adding pins.")
    return entry


def _pin_for(entry, pin_id):
    pin = entry.map_pins.filter(pk=pin_id).first()
    if pin is None:
        reject("INVALID_MAP_PIN", "Choose a pin on this map.")
    return pin


def save_map_pin(wiki, command):
    entry = _require_image_map(wiki, command["map_id"])
    pin = _pin_for(entry, command["pin_id"]) if "pin_id" in command else WikiMapPin(map_entry=entry)
    pin.label = command["label"].strip()
    if not pin.label:
        reject("MISSING_NAME", "Enter a pin label.")
    pin.place = entry_for(wiki, command["place_id"], WikiEntry.Kind.PLACE) if command["place_id"] else None
    pin.x, pin.y = command["x"], command["y"]
    pin.save()
    return pin.pk, set()


def remove_map_pin(wiki, command):
    entry = _require_image_map(wiki, command["map_id"])
    pin = _pin_for(entry, command["pin_id"])
    pin_id = pin.pk
    pin.delete()
    return pin_id, set()


def describe_image_map(entry):
    base = WikiMapImage.objects.filter(entry=entry).first()
    if base is None:
        return None
    return {
        "width": base.width, "height": base.height,
        "pins": [{
            "id": str(pin.pk), "label": pin.label, "x": pin.x, "y": pin.y,
            "place_id": str(pin.place_id) if pin.place_id is not None else None,
        } for pin in entry.map_pins.order_by("created_at", "id")],
    }


@transaction.atomic
def read_map_image(world_id, account_id, map_id, *, observer_id=None):
    _scoped_read()
    wiki_access(world_id, account_id)
    if observer_id is not None:
        # A map base is an authoring asset until its imagery and layers have a viewpoint policy.
        raise resource_unavailable()
    base = WikiMapImage.objects.filter(
        wiki_id=world_id, entry_id=map_id, entry__wiki_id=world_id, entry__kind=WikiEntry.Kind.MAP,
    ).first()
    if base is None:
        raise resource_unavailable()
    return base
