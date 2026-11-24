# CGS v1

This branch implements Django sessions and authenticated private-world creation against PostgreSQL 17. Django admin provisions test accounts. The world API uses the same session cookie and CSRF flow that the browser client will use.

## Run locally with Docker Compose

Start Docker Desktop, then from the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up --build -d
docker compose exec api python manage.py createsuperuser
docker compose exec api python manage.py test
```

The sample settings are for loopback development. Compose waits for PostgreSQL and applies migrations before starting the API. The database runs on the Compose network, so this setup does not need a host PostgreSQL port. The admin is at http://127.0.0.1:8000/admin/ and the session API is at http://127.0.0.1:8000/api/v1/session. Run `docker compose down` to stop the services and retain the database volume.

## Run against a native PostgreSQL 17 instance

Provision a dedicated development database and login role that owns it. Django's test runner also needs to create and drop a separate test database. Use a development-only role with `CREATEDB` for this. From PowerShell, with Python 3.14 installed:

```powershell
py -3.14 -m venv .venv
& ./.venv/Scripts/python.exe -m pip install -r backend/requirements.txt

$env:CGS_SECRET_KEY = [guid]::NewGuid().ToString()
$env:CGS_DB_HOST = '127.0.0.1'
$env:CGS_DB_PORT = '5432'
$env:CGS_DB_NAME = 'cgs'
$env:CGS_DB_USER = 'cgs'
$env:CGS_DB_PASSWORD = Read-Host 'Development database password' -MaskInput
$env:CGS_DEBUG = '1'

& ./.venv/Scripts/python.exe backend/manage.py migrate
& ./.venv/Scripts/python.exe backend/manage.py createsuperuser
& ./.venv/Scripts/python.exe backend/manage.py test cgs.worlds --verbosity 2
& ./.venv/Scripts/python.exe backend/manage.py runserver
```

## Exercise the API

1. `GET /api/v1/session` returns the current session and a masked CSRF token. Preserve the response cookie.
2. `POST /api/v1/session/login` with JSON `username` and `password` and the current `X-CSRFToken` header. Preserve the updated cookies and token returned by login.
3. `POST /api/v1/worlds` with JSON `{"name":"My dungeon"}`, the updated CSRF token, and a new UUID in `Idempotency-Key`. Resend the same body and key to recover the original creation result.
4. `GET /api/v1/worlds` lists worlds granted to the signed-in account. `GET /api/v1/worlds/{world_id}` retrieves one visible world. Use a second Django admin-provisioned account to verify that an unassigned world is absent from its list and returns the same response as a missing world by direct lookup.
5. `POST /api/v1/session/logout` with the current CSRF token ends the session.
