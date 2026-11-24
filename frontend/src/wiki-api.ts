import { request } from './api'

export type WikiKind = 'person' | 'place' | 'group' | 'class' | 'ability' | 'item'
export type WikiEntry = { id: string; name: string; kind: WikiKind; author_only?: boolean }
export type WikiField = {
  key: string
  label: string
  kinds: WikiKind[]
  value_kind: 'text' | 'integer' | 'reference'
  target_kind: WikiKind | null
  choices: string[]
}
export type WikiValue = string | number
export type WikiSection = 'all' | 'characters' | 'places' | 'library' | 'timeline'
export type WikiLocation = { at: number; viewAs: string; entryId: string; section?: WikiSection; eventId?: string }
export type WikiAssertion = {
  id: string; field: string; value: WikiValue; from_tick: number; until_tick: number | null
  author_only: boolean; source: string; event_id: string | null
}
export type WikiClaim = {
  id: string; field: string; value: WikiValue; tick: number; speaker_id: string
  author_only: boolean; source: string
}
export type WikiObservation = {
  id: string; field: string; value: WikiValue; about_tick: number; learned_at: number
  observer_id: string; source_kind: 'assertion' | 'claim'; source_id?: string; speaker_id?: string
}
type AbilityUse = { ability_id: string; actor_id: string }

export type WikiEvent = {
  id: string; name: string; tick: number; source: string; description: string
  links: { entry_id: string; role: 'participant' | 'place' | 'item' }[]
  ability_use: AbilityUse | null
  changes: { entry_id: string; field: string; value: WikiValue }[]
}

export type WikiLearnedAbility = { id: string; ability_id: string; learned_at: number; source: string }
export type WikiFinding = {
  id: string; code: 'CANON_CONFLICT' | 'OBSERVATION_SOURCE_CHANGED'; field: string
  record_ids: string[]; from_tick: number; until_tick: number | null
}
export type WikiArticle = {
  entry: WikiEntry
  values?: ({ field: string } & ({ state: 'value'; value: WikiValue } | { state: 'unknown' | 'conflict' }))[]
  assertions?: WikiAssertion[]
  claims?: WikiClaim[]
  events?: WikiEvent[]
  learned_abilities?: WikiLearnedAbility[]
  contents?: WikiEntry[]
  observations: WikiObservation[]
  findings?: WikiFinding[]
}
export type WikiView = {
  world_name: string; at: number; viewpoint: WikiEntry | null; entries: WikiEntry[]; fields: WikiField[]
  article: WikiArticle | null; can_edit?: boolean; edit_counter?: number
  timeline?: WikiEvent[]
}

type TypedValue = { field: string; value: WikiValue; author_only: boolean }
type FieldChange = { entry_id: string } & TypedValue
type EventDetails = {
  name: string; source: string; description: string; ability_use: AbilityUse | null
  participant_ids: string[]; place_ids: string[]; item_ids: string[]
}
export type WikiCommand =
  | { op: 'create_entry'; name: string; kind: WikiKind; author_only: boolean; initial_at?: number; initial_values?: TypedValue[] }
  | { op: 'rename_entry'; entry_id: string; name: string }
  | ({ op: 'record_fact'; from_tick: number; until_tick: number | null; source: string } & FieldChange)
  | { op: 'correct_fact'; assertion_id: string; value: WikiValue }
  | ({ op: 'record_event'; tick: number; changes: FieldChange[] } & EventDetails)
  | ({ op: 'edit_event'; event_id: string } & EventDetails)
  | { op: 'correct_event_date'; event_id: string; tick: number }
  | ({ op: 'record_claim'; speaker_id: string; tick: number; source: string } & FieldChange)
  | { op: 'record_observation'; observer_id: string; source_id: string; source_kind: 'assertion' | 'claim'; learned_at: number }
  | { op: 'record_learned_ability'; character_id: string; ability_id: string; learned_at: number; source: string }
  | { op: 'correct_learned_ability'; learned_ability_id: string; learned_at: number; source: string }

export type WikiAttempt = { key: string; edit: number; command: WikiCommand; location: WikiLocation }

const wikiPath = (worldId: string) => '/worlds/' + encodeURIComponent(worldId) + '/wiki'

export function getWiki(worldId: string, location: WikiLocation, signal: AbortSignal) {
  const params = new URLSearchParams({ at: String(location.at) })
  if (location.viewAs) params.set('view_as', location.viewAs)
  const path = location.section === 'timeline' ? '/timeline' : location.entryId ? '/entries/' + encodeURIComponent(location.entryId) : ''
  return request<WikiView>(wikiPath(worldId) + path + '?' + params.toString(), { signal })
}

export function saveWikiChange(worldId: string, attempt: WikiAttempt, token: string) {
  return request<{ receipt_id: string; edit_counter: number; record_id: string }>(wikiPath(worldId) + '/changes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': token,
      'Idempotency-Key': attempt.key,
    },
    body: JSON.stringify({ expected_edit: attempt.edit, command: attempt.command }),
  })
}

const prefix = (accountId: string) => 'cgs.wiki-change.' + accountId + '.'

export function readWikiAttempt(accountId: string, worldId: string): WikiAttempt | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(prefix(accountId) + worldId) ?? 'null') as WikiAttempt | null
    return stored && typeof stored.key === 'string' && Number.isSafeInteger(stored.edit) &&
      stored.location && Number.isSafeInteger(stored.location.at) &&
      typeof stored.location.viewAs === 'string' && typeof stored.location.entryId === 'string' &&
      typeof stored.command?.op === 'string' ? stored : null
  } catch {
    return null
  }
}

export function storeWikiAttempt(accountId: string, worldId: string, attempt: WikiAttempt | null) {
  try {
    const key = prefix(accountId) + worldId
    if (attempt) sessionStorage.setItem(key, JSON.stringify(attempt))
    else sessionStorage.removeItem(key)
  } catch {
    // Retry remains available in the current page.
  }
}

export function clearWikiAttempts(accountId: string) {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(prefix(accountId))) sessionStorage.removeItem(key)
    }
  } catch {
    // The browser may disable storage.
  }
}
