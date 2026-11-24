import { request } from './api'

export type WikiKind = 'person' | 'place' | 'group' | 'class' | 'ability' | 'item'
  | 'species' | 'organism' | 'culture' | 'role' | 'resource' | 'body_part' | 'trait' | 'goal'
export type WikiEntry = { id: string; name: string; kind: WikiKind; author_only?: boolean }
export type WikiField = {
  key: string
  label: string
  kinds: WikiKind[]
  value_kind: 'text' | 'integer' | 'decimal' | 'reference'
  target_kind: WikiKind | null
  choices: string[]
  section: string
  target_kinds: WikiKind[]
  qualifier_kind: WikiKind | null
  qualifier_required: boolean
  many: boolean
}
export type WikiValue = string | number
export type WikiSection = 'all' | 'characters' | 'places' | 'library' | 'timeline'
export type WikiLocation = { at: number; viewAs: string; entryId: string; section?: WikiSection; eventId?: string }
export type WikiAssertion = {
  id: string; field: string; value: WikiValue; from_tick: number; until_tick: number | null
  author_only: boolean; source: string; event_id: string | null
  qualifier_id?: string | null
}
export type WikiClaim = {
  id: string; field: string; value: WikiValue; tick: number; speaker_id: string
  author_only: boolean; source: string
  qualifier_id?: string | null
}
export type WikiObservation = {
  id: string; field: string; value: WikiValue; about_tick: number; learned_at: number
  observer_id: string; source_kind: 'assertion' | 'claim'; source_id?: string; speaker_id?: string
  entry_id: string; qualifier_id?: string | null
}
type AbilityUse = { ability_id: string; actor_id: string }

export type WikiEvent = {
  id: string; name: string; tick: number | null; source: string; description: string
  node_kind: 'group' | 'occurrence' | 'action'; parent_id: string | null; sort_order: number
  start_tick: number | null; end_tick: number | null; display_start: number | null; display_end: number | null
  cross_reference_ids: string[]
  links: { entry_id: string; role: 'participant' | 'place' | 'item' }[]
  ability_use: AbilityUse | null
  changes: {
    id: string; entry_id: string; field: string; value: WikiValue | null; previous_value: WikiValue | null
    qualifier_id: string | null
  }[]
}

export type WikiLearnedAbility = { id: string; ability_id: string; learned_at: number; source: string }
export type WikiFinding = {
  id: string; code: 'CANON_CONFLICT' | 'OBSERVATION_SOURCE_CHANGED'; field: string
  record_ids: string[]; from_tick: number; until_tick: number | null
}
export type WikiEffectiveValue = {
  field: string; qualifier_id?: string; default_sources?: string[]; unit?: string
} & ({ state: 'value'; value: WikiValue } | { state: 'unknown' | 'conflict' })
export type WikiLinkedFact = {
  id: string; entry_id: string; field: string; label: string; qualifier_id: string | null
  from_tick: number; until_tick: number | null; source: string
}
export type WikiProposition = {
  id: string; holder_id: string; subject_id: string; kind: 'belief' | 'desired_state'
  field: string; value: WikiValue; qualifier_id: string | null; from_tick: number; until_tick: number | null
  about_tick: number | null; evidence_id: string | null; source: string; author_only: boolean
}
export type WikiWaypoint = { id: string; name: string; x_cm: number; y_cm: number }
export type WikiBounds = { left_cm: number; top_cm: number; width_cm: number; height_cm: number }
export type WikiLayoutFrame = {
  id: string; place_id: string; name: string; from_tick: number; points: WikiWaypoint[]
} & WikiBounds
export type WikiConnection = {
  id: string; name: string; from_place: string; from_point: string; to_place: string; to_point: string
  from_tick: number; until_tick: number | null; bidirectional: boolean; length_cm: number | null
  description: string; source: string
}
export type WikiPlaceLayout = {
  frame: WikiLayoutFrame | null; available: WikiLayoutFrame[]; connections: WikiConnection[]
}
export type WikiArticle = {
  entry: WikiEntry
  values?: WikiEffectiveValue[]
  assertions?: WikiAssertion[]
  claims?: WikiClaim[]
  events?: WikiEvent[]
  learned_abilities?: WikiLearnedAbility[]
  contents?: WikiEntry[]
  parts?: WikiEntry[]
  occupants?: WikiEntry[]
  layout?: WikiPlaceLayout
  legacy_location_review?: boolean
  observations: WikiObservation[]
  findings?: WikiFinding[]
  incoming_links?: WikiLinkedFact[]
  propositions?: WikiProposition[]
  age_years?: number | null
}
export type WikiView = {
  world_name: string; at: number; viewpoint: WikiEntry | null; entries: WikiEntry[]; fields: WikiField[]
  article: WikiArticle | null; can_edit?: boolean; edit_counter?: number
  timeline?: WikiEvent[]
  days_per_year?: number | null
}

export function isWikiActor(entry: WikiEntry) {
  return entry.kind === 'person' || entry.kind === 'organism'
}

type TypedValue = { field: string; value: WikiValue; author_only: boolean; qualifier_id?: string }
type FieldChange = { entry_id: string } & TypedValue
type EventChange = FieldChange & { mode?: 'set' | 'add' | 'end'; source?: string }
type EventDetails = {
  name: string; source: string; description: string; ability_use: AbilityUse | null
  participant_ids: string[]; place_ids: string[]; item_ids: string[]
  start_tick?: number | null; end_tick?: number | null
  cross_reference_ids?: string[]
}
export type WikiCommand =
  | { op: 'create_entry'; name: string; kind: WikiKind; author_only: boolean; initial_at?: number; initial_values?: TypedValue[] }
  | { op: 'rename_entry'; entry_id: string; name: string }
  | ({ op: 'record_fact'; from_tick: number; until_tick: number | null; source: string } & FieldChange)
  | { op: 'correct_fact'; assertion_id: string; value: WikiValue; source?: string; author_only?: boolean }
  | ({ op: 'record_event'; tick: number; changes: EventChange[]; parent_id?: string; node_kind?: 'action' | 'occurrence' } & EventDetails)
  | ({ op: 'record_event_group'; parent_id?: string } & EventDetails)
  | ({ op: 'edit_event'; event_id: string } & EventDetails)
  | { op: 'organize_event'; event_id: string; parent_id: string | null; position?: number }
  | { op: 'correct_event_date'; event_id: string; tick: number }
  | ({ op: 'record_claim'; speaker_id: string; tick: number; source: string } & FieldChange)
  | { op: 'record_observation'; observer_id: string; source_id: string; source_kind: 'assertion' | 'claim'; learned_at: number; about_tick?: number }
  | ({
    holder_id: string; from_tick: number; until_tick: number | null; about_tick: number | null
    evidence_id: string | null; source: string
  } & FieldChange & ({ op: 'record_proposition' } | { op: 'correct_proposition'; proposition_id: string }))
  | { op: 'set_calendar'; days_per_year: number | null }
  | ({ op: 'save_layout'; place_id: string; name: string; from_tick: number } & WikiBounds)
  | { op: 'save_waypoint'; place_id: string; point_id?: string; from_tick: number; name: string; x_cm: number; y_cm: number }
  | ({ op: 'save_connection'; connection_id?: string } & Omit<WikiConnection, 'id'>)
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
