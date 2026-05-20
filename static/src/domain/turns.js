// Turn payload normalization: server-shape → frontend-shape conversion.
// visibleText is exported because ui/render-turn.js uses the same
// committed/preview merge rule to decide whether to render a row.

import { LANE_IDS, TURN_STATES } from '../shared/constants.js';
import { normalizeLanguageName } from './languages.js';
import {
  createLocalTurn,
  currentLaneId,
  ensureLane,
} from './lanes.js';
import { state } from '../state.js';

export function normalizeTurnPayload(payload) {
  const fallback = createLocalTurn(currentLaneId(), state.lanes);
  const laneId = LANE_IDS.includes(payload?.lane_id) ? payload.lane_id : fallback.laneId;
  const lane = ensureLane(laneId);
  const parts = Array.isArray(payload?.parts) ? payload.parts.map(normalizeTurnPart) : [];
  const sourceText = String(payload?.source_text || joinPartText(parts, 'source') || '');
  const targetText = String(payload?.target_text || joinPartText(parts, 'target') || '');
  const speakableTargetText = String(payload?.speakable_target_text || joinSpeakableTargetText(parts) || '');
  return {
    turnId: String(payload?.turn_id || fallback.turnId),
    laneId,
    direction: String(payload?.direction || `${lane.sourceLanguage}->${lane.targetLanguage}`),
    state: String(payload?.state || TURN_STATES.OPEN_EMPTY),
    sourceLanguage: normalizeLanguageName(payload?.source_language || lane.sourceLanguage),
    targetLanguage: normalizeLanguageName(payload?.target_language || lane.targetLanguage),
    sourceText,
    targetText,
    speakableTargetText,
    canTranslateNow: Boolean(payload?.can_translate_now ?? joinTranslatableSourcePreviewText(parts)),
    canSpeakNow: Boolean(payload?.can_speak_now ?? speakableTargetText),
    parts,
  };
}

function normalizeTurnPart(part) {
  const sourceCommittedText = String(part?.source_committed_text || '');
  const sourcePreviewText = String(part?.source_preview_text || '');
  const targetCommittedText = String(part?.target_committed_text || '');
  const targetPreviewText = String(part?.target_preview_text || '');
  return {
    partId: String(part?.part_id || ''),
    speechState: String(part?.speech_state || 'pending'),
    sourceCommittedText,
    sourcePreviewText,
    sourceText: String(part?.source_text || visibleText(sourceCommittedText, sourcePreviewText)),
    targetCommittedText,
    targetPreviewText,
    targetText: String(part?.target_text || visibleText(targetCommittedText, targetPreviewText)),
    lowQualityReference: Boolean(part?.low_quality_reference),
    isClosed: Boolean(part?.is_closed),
  };
}

function joinPartText(parts, role) {
  return (parts || [])
    .map((part) => role === 'source' ? part.sourceText : part.targetText)
    .filter(Boolean)
    .join('\n\n');
}

function joinSpeakableTargetText(parts) {
  return (parts || [])
    .filter((part) => part.speechState !== 'spoken')
    .map((part) => part.targetText)
    .filter(Boolean)
    .join('\n\n');
}

function joinTranslatableSourcePreviewText(parts) {
  return (parts || [])
    .filter((part) => part.speechState !== 'spoken')
    .map((part) => part.sourcePreviewText)
    .filter(Boolean)
    .join('\n\n');
}

export function visibleText(committed, preview) {
  const left = String(committed || '').trim();
  const right = String(preview || '').trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}
