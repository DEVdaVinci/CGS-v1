export type SignedInSession = {
  authenticated: true
  csrf_token: string
  account_id: string
  display_name: string
}

export type Session = SignedInSession | { authenticated: false; csrf_token: string }

export type World = {
  id: string
  name: string
  role: 'owner' | 'editor' | 'reader' | 'player'
  capabilities: string[]
}

export type WorldPage = { items: World[]; next_cursor: string | null }

type CreatedWorld = {
  world: World
  draft_id: string
  head_revision: number
  receipt_id: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fieldErrors: { code: string; message: string; pointer?: string }[] = [],
    readonly conflictRevision?: number,
  ) {
    super(code)
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  const response = await fetch('/api/v1' + path, {
    ...options,
    credentials: 'same-origin',
    headers,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      code?: string
      field_errors?: ApiError['fieldErrors']
      conflict_revision?: number
    } | null
    throw new ApiError(response.status, body?.code ?? 'UNEXPECTED_RESPONSE', body?.field_errors, body?.conflict_revision)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function getSession(signal?: AbortSignal) {
  return request<Session>('/session', { signal })
}

export function signIn(username: string, password: string, token: string) {
  return request<SignedInSession>('/session/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token },
    body: JSON.stringify({ username, password }),
  })
}

export function signOut(token: string) {
  return request<void>('/session/logout', {
    method: 'POST',
    headers: { 'X-CSRFToken': token },
  })
}

export function listWorlds(cursor?: string, signal?: AbortSignal, query = '') {
  const params = new URLSearchParams()
  if (cursor) params.set('cursor', cursor)
  if (query) params.set('q', query)
  const suffix = params.size ? '?' + params : ''
  return request<WorldPage>('/worlds' + suffix, { signal })
}

export function getWorld(worldId: string, signal?: AbortSignal) {
  return request<World>('/worlds/' + encodeURIComponent(worldId), { signal })
}

export function createWorld(name: string, key: string, token: string) {
  return request<CreatedWorld>('/worlds', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': token,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ name }),
  })
}

// The UI waits to confirm creation before releasing its idempotency key.
export type PendingCreation = { name: string; key: string }

const creationStorageKey = (accountId: string) => 'cgs.world-create.' + accountId

export function readPendingCreation(accountId: string): PendingCreation | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(creationStorageKey(accountId)) ?? 'null')
    if (
      value && typeof value === 'object' &&
      'name' in value && typeof value.name === 'string' &&
      'key' in value && typeof value.key === 'string'
    ) {
      return { name: value.name, key: value.key }
    }
  } catch {
    // A blocked or unavailable storage API does not prevent in-page retry.
  }
  return null
}

export function savePendingCreation(accountId: string, attempt: PendingCreation | null) {
  try {
    const key = creationStorageKey(accountId)
    if (attempt) sessionStorage.setItem(key, JSON.stringify(attempt))
    else sessionStorage.removeItem(key)
  } catch {
    // A blocked or unavailable storage API does not prevent in-page retry.
  }
}
