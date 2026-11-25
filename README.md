# CGS v1

## Open CGS with Docker Compose

Start Docker Desktop and open PowerShell in this repository. If you already set up the backend, use your existing .env file and Django account.

```powershell
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item .env.example .env }
docker compose up --build -d
```

On a fresh database, create a Django account once.

```powershell
docker compose exec api python manage.py createsuperuser
```

Open [CGS](http://127.0.0.1:8000/), sign in, and select **Create world**. Open the world and select **Open Wiki**. Start from the overview or use the sidebar to reach **Characters**, **Places**, **Items**, **Vehicles**, **Maps**, or **Timeline**. On a narrow screen, open **Menu**.

In **Build**, use **Search this world** to find an article by name. Use the section's creation button or **New entry**. An article's **Overview** holds its editable summary. Open **History** to inspect dated facts and events, choose a time or preview a character's knowledge. Add an effective date when recording a new fact. Open **Timeline** for events and calendar settings. **Maps** lists map references. For a measured room plan, open its place, choose a date in **History**, and use **Place layout**.

The world page also offers **Edit draft** for the dungeon draft.

1. In **Entries**, create places, roles, characters, and items and link the related records.
2. In **Layout & facts**, stage room bounds, points, paths, and facts. Select **Save layout and facts** to save the group. A secret path and its revealing fact can go in the same group.
3. In **Rules**, configure action and progression rules. Return to **Entries** to grant those rules and set character behavior.
4. In **Starting state**, place characters and items, set stats and initial knowledge, and save the encounter.

Use **Previous revision** to review an earlier snapshot. Use [Django admin](http://127.0.0.1:8000/admin/) to manage accounts.

The Compose setup is for local development. It builds the browser app, starts PostgreSQL, and applies migrations before starting Django. Run `docker compose ps -a` to check startup. Expect `api` to be running, `db` to be healthy, and `migrate` to have exited with code 0. Run `docker compose down` to stop the services and retain the database volume.

## Alternative setup with native PostgreSQL 17

Use these steps to run CGS directly on Windows. Install Python 3.14 and Node.js 24, then create a dedicated CGS database and a PostgreSQL login that owns it. To run Django's tests, give the development login permission to create databases. The database login belongs to PostgreSQL. You sign in to CGS with a Django account created in that database.

```powershell
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
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
& ./.venv/Scripts/python.exe backend/manage.py runserver
```

Run `createsuperuser` once for each fresh database. Open the same local CGS URL once Django is running.

## Developer checks

Run the backend tests with `docker compose exec api python manage.py test`. Django uses a separate test database for this command.

For the browser tests, use a disposable CGS instance with two ordinary Django test accounts named `e2e-owner` and `e2e-other` and a shared test password. With Chrome installed, run `npm.cmd --prefix frontend ci`, set `CGS_E2E_URL` to the instance URL and `CGS_E2E_PASSWORD` to the test password, then run `npm.cmd --prefix frontend run test:e2e`.

## Exercise the API

1. `GET /api/v1/session` returns the current session and a masked CSRF token. Preserve the response cookie.
2. `POST /api/v1/session/login` with JSON `username` and `password` and the current `X-CSRFToken` header. Preserve the updated cookies and token returned by login.
3. `POST /api/v1/worlds` with JSON `{"name":"My dungeon"}`, the updated CSRF token, and a new UUID in `Idempotency-Key`. Resend the same body and key to recover the original creation result.
4. `GET /api/v1/worlds` lists worlds granted to the signed-in account. `GET /api/v1/worlds/{world_id}` retrieves one visible world. An unassigned world is absent from the list and returns the same response as a missing world by direct lookup.
5. `POST /api/v1/session/logout` with the current CSRF token ends the session.
