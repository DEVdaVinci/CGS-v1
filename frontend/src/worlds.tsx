import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  createWorld,
  getWorld,
  listWorlds,
  readPendingCreation,
  savePendingCreation,
  type PendingCreation,
  type SignedInSession,
  type World,
} from './api'

type AuthErrorHandler = (error: unknown) => boolean

const roleLabel: Record<World['role'], string> = {
  owner: 'Owner',
  editor: 'Editor',
  reader: 'Reader',
  player: 'Player',
}

export function WorldLibrary({
  account,
  onAuthError,
}: {
  account: SignedInSession
  onAuthError: AuthErrorHandler
}) {
  const [worlds, setWorlds] = useState<World[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listFailed, setListFailed] = useState(false)
  const listRequest = useRef<AbortController | null>(null)
  const [attempt, setAttempt] = useState(() => readPendingCreation(account.account_id))
  const [formOpen, setFormOpen] = useState(Boolean(attempt))
  const [name, setName] = useState(attempt?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [createdName, setCreatedName] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const createButton = useRef<HTMLButtonElement>(null)

  const loadPage = useCallback(async (cursor?: string) => {
    listRequest.current?.abort()
    const request = new AbortController()
    listRequest.current = request
    setListLoading(true)
    setListFailed(false)
    try {
      const page = await listWorlds(cursor, request.signal)
      if (request.signal.aborted) return
      setWorlds((previous) => [...new Map([...previous, ...page.items].map((world) => [world.id, world])).values()])
      setNextCursor(page.next_cursor)
    } catch (error) {
      if (!request.signal.aborted && !onAuthError(error)) setListFailed(true)
    } finally {
      if (!request.signal.aborted) setListLoading(false)
    }
  }, [onAuthError])

  useEffect(() => {
    void loadPage()
    return () => listRequest.current?.abort()
  }, [loadPage])

  useEffect(() => {
    if (formOpen && !attempt) nameInput.current?.focus()
  }, [formOpen, attempt])

  function rememberCreation(value: PendingCreation | null) {
    setAttempt(value)
    savePendingCreation(account.account_id, value)
  }

  function closeForm() {
    setFormOpen(false)
    setName('')
    setSaveError('')
    createButton.current?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const title = name.trim().normalize('NFC')
    if (!attempt && (!title || Array.from(title).length > 100)) {
      setSaveError('Enter a world name between 1 and 100 characters.')
      return
    }
    const request = attempt ?? { name: title, key: crypto.randomUUID() }
    rememberCreation(request)
    setName(request.name)
    setSaving(true)
    setSaveError('')
    setCreatedName('')
    try {
      const { world } = await createWorld(request.name, request.key, account.csrf_token)
      rememberCreation(null)
      setWorlds((previous) => [world, ...previous.filter((item) => item.id !== world.id)])
      setCreatedName(world.name)
      closeForm()
    } catch (error) {
      if (onAuthError(error)) return
      if (error instanceof ApiError && [400, 404, 409, 422].includes(error.status)) {
        rememberCreation(null)
        setSaveError(
          error.code === 'KEY_REUSED'
            ? 'This save could not be retried. Check your world list before creating it again.'
            : 'CGS couldn’t save this world. Check the name and try again.',
        )
      } else {
        setSaveError('CGS couldn’t confirm the save. Retry to recover the result without creating a second world.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="workspace-heading">
        <h1>Worlds</h1>
        <button
          className="button primary"
          type="button"
          ref={createButton}
          aria-expanded={formOpen}
          onClick={() => {
            setCreatedName('')
            setFormOpen(true)
            nameInput.current?.focus()
          }}
        >
          Create world
        </button>
      </div>

      {formOpen && (
        <section className="creation-panel" aria-labelledby="creation-title">
          <h2 id="creation-title">New world</h2>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="world-name">World name</label>
              <input
                id="world-name"
                name="world-name"
                ref={nameInput}
                value={name}
                onChange={(event) => setName(event.target.value)}
                readOnly={Boolean(attempt)}
                required
              />
            </div>
            {saveError && <p className="error-message" role="alert">{saveError}</p>}
            {!saveError && attempt && !saving && (
              <p className="notice" role="status">A previous save is unconfirmed. Retry to recover it.</p>
            )}
            <div className="form-actions">
              <button className="button primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : attempt ? 'Retry save' : 'Save world'}
              </button>
              {!attempt && <button className="button secondary" type="button" onClick={closeForm}>Cancel</button>}
            </div>
          </form>
        </section>
      )}
      {createdName && <p className="notice success" role="status">Created {createdName}.</p>}

      {listFailed && (
        <div className="list-error">
          <p className="error-message" role="alert">CGS couldn’t load your worlds.</p>
          <button className="button secondary" onClick={() => void loadPage(nextCursor ?? undefined)}>Try again</button>
        </div>
      )}
      {worlds.length > 0 && (
        <ul className="world-grid" aria-label="Your worlds">
          {worlds.map((world) => (
            <li key={world.id}>
              <a className="world-card" href={'/worlds/' + world.id + '/'} aria-labelledby={'world-' + world.id} aria-describedby={'role-' + world.id}>
                <span className="world-card-icon" aria-hidden="true"><span /><span /><span /><span /></span>
                <span className="world-card-name" id={'world-' + world.id}>{world.name}</span>
                <span className="world-card-role" id={'role-' + world.id}>{roleLabel[world.role]}</span>
                <span className="world-card-arrow" aria-hidden="true">→</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {listLoading && <p className="muted" role="status">Loading worlds…</p>}
      {!listLoading && !listFailed && worlds.length === 0 && (
        <p className="empty-state">No worlds yet. Create one to get started.</p>
      )}
      {!listLoading && !listFailed && nextCursor && (
        <button className="button secondary load-more" onClick={() => void loadPage(nextCursor)}>Load more</button>
      )}
    </>
  )
}

export function WorldOverview({ worldId, onAuthError }: { worldId: string; onAuthError: AuthErrorHandler }) {
  const [world, setWorld] = useState<World | null>(null)
  const [failure, setFailure] = useState<'unavailable' | 'connection' | null>(null)
  const [requestNumber, setRequestNumber] = useState(0)

  useEffect(() => {
    const request = new AbortController()
    void getWorld(worldId, request.signal).then(
      (result) => {
        if (!request.signal.aborted) setWorld(result)
      },
      (error: unknown) => {
        if (request.signal.aborted || onAuthError(error)) return
        setFailure(error instanceof ApiError && error.status === 404 ? 'unavailable' : 'connection')
      },
    )
    return () => request.abort()
  }, [worldId, requestNumber, onAuthError])

  return (
    <>
      <a className="back-link" href="/">← All worlds</a>
      {world && (
        <>
          <div className="workspace-heading">
            <h1>{world.name}</h1>
            {(world.role === 'owner' || world.role === 'editor') && (
              <div className="form-actions">
                <a className="button primary" href={'/worlds/' + world.id + '/wiki/'}>Open Wiki</a>
                <a className="button secondary" href={'/worlds/' + world.id + '/draft/'}>
                  {world.role === 'owner' || world.capabilities.includes('edit_world') ? 'Edit draft' : 'View draft'}
                </a>
              </div>
            )}
          </div>
          <dl className="world-metadata">
            <div>
              <dt>Your role</dt>
              <dd>{roleLabel[world.role]}</dd>
            </div>
          </dl>
        </>
      )}
      {!world && !failure && <p className="muted" role="status">Loading world…</p>}
      {failure === 'unavailable' && (
        <section className="error-state">
          <h1>World unavailable</h1>
          <p className="muted">Choose a world from your list.</p>
        </section>
      )}
      {failure === 'connection' && (
        <section className="error-state">
          <h1>Couldn’t load this world</h1>
          <button className="button secondary" onClick={() => {
            setFailure(null)
            setRequestNumber((previous) => previous + 1)
          }}>Try again</button>
        </section>
      )}
    </>
  )
}
