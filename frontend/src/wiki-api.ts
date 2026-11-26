import { request } from './api'

export type WikiKind = 'person' | 'place' | 'group' | 'class' | 'ability' | 'item'
  | 'species' | 'organism' | 'culture' | 'role' | 'resource' | 'body_part' | 'trait' | 'goal'
  | 'image' | 'model_3d' | 'texture' | 'animation' | 'map' | 'territory' | 'era'
  | 'source' | 'process' | 'skill' | 'milestone'
  | 'requirement' | 'method' | 'method_step' | 'status_def' | 'context' | 'relation_def' | 'relation'
  | 'body_fn' | 'resource_mv' | 'value_def' | 'preference' | 'motivation'
  | 'behavior' | 'rel_term' | 'health_case'
export type WikiEntry = {
  id: string; name: string; kind: WikiKind; author_only?: boolean
  catalog_type?: 'vehicle'; classification_needs_review?: boolean
}
export type WikiEntryTemplate = WikiKind | 'vehicle'
export type WikiField = {
  key: string
  label: string
  kinds: WikiKind[]
  value_kind: 'text' | 'integer' | 'decimal' | 'reference' | 'distribution' | 'time_window' | 'probability_range' | 'entry_kind'
  target_kind: WikiKind | null
  choices: string[]
  section: string
  target_kinds: WikiKind[]
  qualifier_kind: WikiKind | null
  qualifier_required: boolean
  many: boolean
  uses_unit?: boolean
  initial_only?: boolean
  minimum?: number | null
  maximum?: number | null
}
export type WikiValue = string | number

export function formatTimeWindow(value: WikiValue) {
  if (value === 'unknown') return 'Unknown date'
  const [earliest, latest] = String(value).split(':')
  return 'Between time ' + earliest + ' and ' + latest
}
export type WikiSection = 'overview' | 'all' | 'characters' | 'organisms' | 'places' | 'groups'
  | 'items' | 'vehicles' | 'maps' | 'library' | 'definitions' | 'media' | 'timeline' | 'sources'
export const wikiHistoryPanels = {
  facts: { label: 'Facts and state', needsDate: true, placeOnly: false },
  health: { label: 'Health records', needsDate: true, placeOnly: false },
  relationships: { label: 'Relationships', needsDate: true, placeOnly: false },
  hierarchy: { label: 'Place hierarchy', needsDate: true, placeOnly: true },
  layout: { label: 'Layout and routes', needsDate: true, placeOnly: true },
  events: { label: 'Related events', needsDate: false, placeOnly: false },
  evidence: { label: 'Claims and evidence', needsDate: false, placeOnly: false },
  findings: { label: 'Consistency findings', needsDate: false, placeOnly: false },
} as const
export type WikiHistoryPanel = keyof typeof wikiHistoryPanels
export type WikiLocation = {
  at: number | null; viewAs: string; entryId: string; section?: WikiSection; eventId?: string; history?: boolean
  historyPanel?: WikiHistoryPanel
}
export type WikiAssertion = {
  id: string; field: string; value: WikiValue; from_tick: number; until_tick: number | null
  author_only: boolean; source: string; event_id: string | null
  citation_id: string | null
  qualifier_id?: string | null
  unit?: string | null
}
export type WikiClaim = {
  id: string; field: string; value: WikiValue; tick: number | null; speaker_id: string | null
  date_precision: EventDatePrecision; start_tick: number | null; end_tick: number | null
  author_only: boolean; source: string
  citation_id: string | null
  additional_citation_ids?: string[]
  qualifier_id?: string | null
  unit?: string | null
}
export type WikiObservation = {
  learning_source_id?: string
  id: string; field: string; value: WikiValue; about_tick: number | null; learned_at: number
  observer_id: string; source_kind: 'assertion' | 'claim'; source_id?: string; speaker_id?: string
  entry_id: string; qualifier_id?: string | null
  unit?: string | null
  learning_note?: string; author_only?: boolean
}
type AbilityUse = { ability_id: string; actor_id: string }
export type EventDatePrecision = 'exact' | 'bounded' | 'unknown'
export const eventSignificances = { major: 'Major', minor: 'Minor' } as const
export type EventSignificance = keyof typeof eventSignificances

export type WikiEvent = {
  id: string; name: string; tick: number | null; source: string; description: string
  summary: string; method: string
  citation_id: string | null
  date_precision: EventDatePrecision
  significance?: EventSignificance
  node_kind: 'group' | 'occurrence' | 'action'; parent_id: string | null; sort_order: number
  start_tick: number | null; end_tick: number | null; display_start: number | null; display_end: number | null
  cross_reference_ids: string[]
  cause_event_ids: string[]
  cause_state: (WikiAssertion & { entry_id: string })[]
  links: { entry_id: string; role: 'participant' | 'performer' | 'target' | 'place' | 'item'
    | 'purpose' | 'backstory' | 'era' | 'fulfillment' | 'behavior' }[]
  ability_use: AbilityUse | null
  changes: {
    id: string; entry_id: string; field: string; value: WikiValue | null; previous_value: WikiValue | null
    qualifier_id: string | null
    unit?: string | null; previous_unit?: string | null
  }[]
}

export type WikiLearnedAbility = { id: string; ability_id: string; learned_at: number; source: string }
export type WikiFinding = {
  id: string; field: string
  code: 'CANON_CONFLICT' | 'LIFESPAN_CONFLICT' | 'DATE_OUTSIDE_WINDOW' | 'OBSERVATION_SOURCE_CHANGED' | 'PROBABILITY_OUTSIDE_RANGE'
    | 'RELATIONSHIP_PARTY_KIND' | 'RELATIONSHIP_PARTY_LIMIT'
  record_ids: string[]; from_tick: number; until_tick: number | null
  details?: { relationship_type_id: string } & (
    { actual_kind: WikiKind; allowed_kinds: WikiKind[] } | { actual_count: number; maximum_count: number }
  )
  record_entries?: Record<string, string>
}
export type WikiEffectiveValue = {
  field: string; qualifier_id?: string; default_sources?: string[]; unit?: string
  default_candidates?: { value: WikiValue; unit: string | null; source_ids: string[] }[]
} & ({ state: 'value'; value: WikiValue } | { state: 'unknown' | 'conflict' })
export type WikiLinkedFact = {
  id: string; entry_id: string; field: string; label: string; qualifier_id: string | null
  from_tick: number; until_tick: number | null; source: string
  order?: number | null; order_conflict?: boolean; order_shared?: boolean
  party_scope?: string | null; scope_conflict?: boolean
}
export type WikiProposition = {
  id: string; holder_id: string; subject_id: string; kind: 'belief' | 'desired_state'
  field: string; value: WikiValue; qualifier_id: string | null; from_tick: number; until_tick: number | null
  about_tick: number | null; evidence_id: string | null; source: string; author_only: boolean
  unit?: string | null
  additional_evidence_ids?: string[]; confidence?: string
}
export const causalPhases = { cause: 'Cause', intermediary: 'Intermediary', outcome: 'Outcome' } as const
export type CausalPhase = keyof typeof causalPhases
export type WikiCausalAccount = {
  id: string; title: string; applicability: string; citation_id: string | null
  from_tick: number; until_tick: number | null; author_only: boolean
  terms: { phase: CausalPhase; belief: WikiProposition }[]
}
type CausalAccountInput = Omit<WikiCausalAccount, 'id' | 'terms'> & {
  holder_id: string; terms: { phase: CausalPhase; belief_id: string }[]
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
export type WikiMapPin = {
  id: string; label: string; x: number; y: number; place_id: string | null
}
export type WikiImageMap = {
  width: number; height: number; pins: WikiMapPin[]
}
export type WikiArticleSection = { id: string; heading: string; body: string }
export type WikiDiscovery = { observer_id: string; learned_at: number; source: string }
export type WikiEventReport = {
  id: string; event_id?: string; observer_id: string; title: string; account: string; source: string
  learned_at: number; reported_tick: number | null; earliest_tick: number | null; latest_tick: number | null
  known_entry_ids: string[]; author_only?: boolean
}
type EventReportInput = Omit<WikiEventReport, 'id' | 'event_id'> & { event_id: string }
export type WikiWorldHome = { introduction: string; cover_map_id: string | null; featured: WikiEntry[] }
export type WikiArticle = {
  entry: WikiEntry
  overview?: string
  sections?: WikiArticleSection[]
  variant_of_id?: string | null
  variant_ids?: string[]
  causal_accounts?: WikiCausalAccount[]
  last_sightings?: WikiObservation[]
  discoveries?: WikiDiscovery[]
  values?: WikiEffectiveValue[]
  assertions?: WikiAssertion[]
  claims?: WikiClaim[]
  events?: WikiEvent[]
  event_ancestors?: WikiEvent[]
  family?: {
    parents: string[]; children: string[]
    siblings: { entry_id: string; declared: boolean; shared_parent_ids: string[] }[]
  }
  learned_abilities?: WikiLearnedAbility[]
  contents?: WikiEntry[]
  parts?: WikiEntry[]
  occupants?: WikiEntry[]
  place_path?: string[]
  place_path_needs_review?: boolean
  enclosing_territories?: { place_id: string; territory_id: string }[]
  layout?: WikiPlaceLayout
  image_map?: WikiImageMap
  legacy_location_review?: boolean
  observations: WikiObservation[]
  findings?: WikiFinding[]
  incoming_links?: WikiLinkedFact[]
  propositions?: WikiProposition[]
  age_years?: number | null
}
export type WikiView = {
  world_name: string; at: number | null; viewpoint: WikiEntry | null; entries: WikiEntry[]; fields: WikiField[]
  world_introduction?: string
  world_home?: WikiWorldHome
  home_cover_ids?: string[]
  article: WikiArticle | null; can_edit?: boolean; edit_counter?: number
  event_reports?: WikiEventReport[]
  timeline?: WikiEvent[]
  days_per_year?: number | null
}

export function isWikiActor(entry: WikiEntry) {
  return entry.kind === 'person' || entry.kind === 'organism'
}

export function canPerformEvent(entry: WikiEntry) {
  return isWikiActor(entry) || entry.kind === 'group' || entry.kind === 'item'
}

type TypedValue = { field: string; value: WikiValue; author_only: boolean; qualifier_id?: string }
type FieldChange = { entry_id: string } & TypedValue
type EventChange = FieldChange & { mode?: 'set' | 'add' | 'end'; source?: string }
type EventDetails = {
  name: string; source: string; description: string; ability_use: AbilityUse | null
  citation_id?: string | null
  significance?: EventSignificance | ''
  participant_ids: string[]; place_ids: string[]; item_ids: string[]
  performer_ids?: string[]
  target_ids?: string[]
  summary?: string; method?: string
  cause_event_ids?: string[]; cause_assertion_ids?: string[]
  purpose_ids?: string[]; backstory_ids?: string[]; era_ids?: string[]; fulfillment_ids?: string[]
  behavior_ids?: string[]
  start_tick?: number | null; end_tick?: number | null
  cross_reference_ids?: string[]
}
type ClaimDate = { tick: number | null; date_precision: EventDatePrecision; start_tick: number | null; end_tick: number | null }
export type WikiCommand =
  | {
    op: 'create_entry'; name: string; kind: WikiKind; author_only: boolean; overview?: string
    catalog_type?: 'vehicle'; initial_at?: number; initial_values?: TypedValue[]; variant_of_id?: string
  }
  | { op: 'rename_entry'; entry_id: string; name: string }
  | { op: 'set_variant_origin'; entry_id: string; variant_of_id: string | null }
  | { op: 'update_overview'; entry_id: string; overview: string }
  | { op: 'update_world_introduction'; introduction: string }
  | { op: 'update_world_home'; introduction: string; cover_map_id: string | null; featured_entry_ids: string[] }
  | ({ op: 'set_discovery'; entry_id: string; learned_at: number | null } & Pick<WikiDiscovery, 'observer_id' | 'source'>)
  | (EventReportInput & ({ op: 'record_event_report' } | { op: 'correct_event_report'; report_id: string }))
  | { op: 'update_article_sections'; entry_id: string; sections: WikiArticleSection[] }
  | ({ op: 'record_fact'; from_tick: number; until_tick: number | null; source: string; citation_id?: string | null } & FieldChange)
  | { op: 'correct_fact'; assertion_id: string; value: WikiValue; from_tick?: number; source?: string; citation_id?: string | null; author_only?: boolean; bind_unit?: boolean }
  | ({
    op: 'record_event'; tick: number | null; date_precision?: EventDatePrecision
    changes: EventChange[]; parent_id?: string; node_kind?: 'action' | 'occurrence'
  } & EventDetails)
  | ({ op: 'record_event_group'; parent_id?: string } & EventDetails)
  | ({ op: 'edit_event'; event_id: string; tick?: number | null; date_precision?: EventDatePrecision } & EventDetails)
  | { op: 'organize_event'; event_id: string; parent_id: string | null; position?: number }
  | { op: 'correct_event_date'; event_id: string; tick: number }
  | ({
    op: 'record_claim'; speaker_id: string | null; source: string; citation_id?: string | null; additional_citation_ids?: string[]
  } & FieldChange & ClaimDate)
  | ({
    op: 'correct_claim'; claim_id: string; value: WikiValue; source: string; citation_id: string | null
    additional_citation_ids?: string[]; author_only: boolean; bind_unit?: boolean
  } & ClaimDate)
  | {
    op: 'record_observation'; observer_id: string; source_id: string; source_kind: 'assertion' | 'claim'
    learned_at: number; about_tick?: number; learning_note?: string; learning_source_id?: string; author_only?: boolean
  }
  | ({
    holder_id: string; from_tick: number; until_tick: number | null; about_tick: number | null
    evidence_id: string | null; source: string; additional_evidence_ids?: string[]; confidence?: string | null
  } & FieldChange & (
    { op: 'record_proposition' } | { op: 'correct_proposition'; proposition_id: string }
    | { op: 'change_belief'; previous_belief_id: string }
  ))
  | (CausalAccountInput & ({ op: 'record_causal_account' } | { op: 'correct_causal_account'; account_id: string }))
  | { op: 'set_calendar'; days_per_year: number | null }
  | ({ op: 'save_layout'; place_id: string; name: string; from_tick: number } & WikiBounds)
  | { op: 'save_waypoint'; place_id: string; point_id?: string; from_tick: number; name: string; x_cm: number; y_cm: number }
  | ({ op: 'save_connection'; connection_id?: string } & Omit<WikiConnection, 'id'>)
  | { op: 'create_image_map'; name: string; author_only: boolean; upload_id: string }
  | { op: 'attach_map_image'; map_id: string; upload_id: string }
  | ({ op: 'save_map_pin'; map_id: string; pin_id?: string } & Omit<WikiMapPin, 'id'>)
  | { op: 'remove_map_pin'; map_id: string; pin_id: string }
  | { op: 'record_learned_ability'; character_id: string; ability_id: string; learned_at: number; source: string }
  | { op: 'correct_learned_ability'; learned_ability_id: string; learned_at: number; source: string }

export type WikiAttempt = { key: string; edit: number; command: WikiCommand; location: WikiLocation }

const wikiPath = (worldId: string) => '/worlds/' + encodeURIComponent(worldId) + '/wiki'

export function wikiHref(worldId: string, { at = null, viewAs = '', entryId = '', section, eventId, history, historyPanel }: Partial<WikiLocation> = {}, hash = '') {
  const params = new URLSearchParams()
  if (at !== null) params.set('at', String(at))
  if (viewAs) params.set('view_as', viewAs)
  if (entryId) params.set('entry', entryId)
  if (section && section !== 'overview') params.set('section', section)
  if (section === 'timeline' && eventId) params.set('event', eventId)
  if (entryId && history) params.set('tab', 'history')
  if (entryId && history && historyPanel && !viewAs) params.set('panel', historyPanel)
  return wikiPath(worldId) + '/' + (params.size ? '?' + params : '') + hash
}

export function getWikiHome(worldId: string, signal: AbortSignal) {
  return request<WikiWorldHome & { can_edit: boolean }>(wikiPath(worldId) + '/home', { signal })
}

export function getWiki(worldId: string, location: WikiLocation, signal: AbortSignal) {
  const params = location.at === null ? new URLSearchParams({ overview: 'true' }) : new URLSearchParams({ at: String(location.at) })
  if (location.viewAs) params.set('view_as', location.viewAs)
  const path = location.section === 'timeline' ? '/timeline' : location.entryId ? '/entries/' + encodeURIComponent(location.entryId) : ''
  return request<WikiView>(wikiPath(worldId) + path + '?' + params.toString(), { signal })
}

export function searchWiki(worldId: string, query: string, signal: AbortSignal) {
  return request<{ entries: WikiEntry[] }>(wikiPath(worldId) + '/search?' + new URLSearchParams({ q: query }), { signal })
}

export function uploadMapImage(worldId: string, image: File, key: string, token: string) {
  const body = new FormData()
  body.set('image', image)
  return request<{ upload_id: string }>(wikiPath(worldId) + '/maps/uploads', {
    method: 'POST',
    headers: { 'X-CSRFToken': token, 'Idempotency-Key': key },
    body,
  })
}

export function mapImageUrl(worldId: string, mapId: string) {
  return '/api/v1' + wikiPath(worldId) + '/maps/' + encodeURIComponent(mapId) + '/image'
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
      stored.location && (stored.location.at === null || Number.isSafeInteger(stored.location.at)) &&
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
