import os
from pathlib import Path


SECRET_KEY = os.environ["CGS_SECRET_KEY"]
DEBUG = os.environ.get("CGS_DEBUG") == "1"
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "cgs.accounts",
    "cgs.worlds",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "cgs.urls"
WSGI_APPLICATION = "cgs.wsgi.application"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "HOST": os.environ.get("CGS_DB_HOST", "127.0.0.1"),
        "PORT": os.environ.get("CGS_DB_PORT", "5432"),
        "NAME": os.environ.get("CGS_DB_NAME", "cgs"),
        "USER": os.environ.get("CGS_DB_USER", "cgs"),
        "PASSWORD": os.environ["CGS_DB_PASSWORD"],
    }
}

AUTH_USER_MODEL = "accounts.Account"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": f"django.contrib.auth.password_validation.{name}"}
    for name in (
        "UserAttributeSimilarityValidator",
        "MinimumLengthValidator",
        "CommonPasswordValidator",
        "NumericPasswordValidator",
    )
]
CSRF_FAILURE_VIEW = "cgs.api.csrf_failure"
REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "cgs.api.handle_api_exception",
}

USE_TZ = True
TIME_ZONE = "UTC"
STATIC_URL = "/static/"
FRONTEND_BUILD_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
STATICFILES_DIRS = [("cgs", FRONTEND_BUILD_DIR)] if FRONTEND_BUILD_DIR.is_dir() else []
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
