import { api, SessionSocket } from './api-client.js';
import { AudioCapture } from './shared/audio-capture.js';
import { AudioQueue } from './shared/audio-playback.js';
import { languages } from './shared/languages.js';

const LANE_IDS = ['a_to_b', 'b_to_a'];
const TURN_STATES = {
  OPEN_EMPTY: 'open_empty',
  OPEN_ACTIVE_UNSPOKEN: 'open_active_unspoken',
  OPEN_SPEAKING: 'open_speaking',
  OPEN_SPOKEN_IDLE: 'open_spoken_idle',
};

const els = {
  listenButton: document.querySelector('#listenButton'),
  miniStatus: document.querySelector('#miniStatus'),
  sourceLanguageChip: document.querySelector('#sourceLanguageChip'),
  targetLanguageChip: document.querySelector('#targetLanguageChip'),
  sourceLanguageCode: document.querySelector('#sourceLanguageCode'),
  targetLanguageCode: document.querySelector('#targetLanguageCode'),
  vadBadge: document.querySelector('#vadBadge'),
  sourcePaneMeta: document.querySelector('#sourcePaneMeta'),
  targetPaneMeta: document.querySelector('#targetPaneMeta'),
  settingsButton: document.querySelector('#settingsButton'),
  sourceText: document.querySelector('#sourceText'),
  targetText: document.querySelector('#targetText'),
  speakNowButton: document.querySelector('#speakNowButton'),
  clearTurnButton: document.querySelector('#clearTurnButton'),
  swapButton: document.querySelector('#swapButton'),
  audioResumeButton: document.querySelector('#audioResumeButton'),
  ttsAudio: document.querySelector('#ttsAudio'),
  languageSheet: document.querySelector('#languageSheet'),
  languageSheetScrim: document.querySelector('#languageSheetScrim'),
  languageSheetClose: document.querySelector('#languageSheetClose'),
  languageSheetTitle: document.querySelector('#languageSheetTitle'),
  languageOptions: document.querySelector('#languageOptions'),
  settingsSheet: document.querySelector('#settingsSheet'),
  settingsSheetTitle: document.querySelector('#settingsSheetTitle'),
  settingsSheetScrim: document.querySelector('#settingsSheetScrim'),
  settingsBackButton: document.querySelector('#settingsBackButton'),
  settingsHomePage: document.querySelector('#settingsHomePage'),
  settingsMicrophoneNav: document.querySelector('#settingsMicrophoneNav'),
  settingsAudioNav: document.querySelector('#settingsAudioNav'),
  settingsMicrophonePage: document.querySelector('#settingsMicrophonePage'),
  settingsAudioPage: document.querySelector('#settingsAudioPage'),
  micPreGain: document.querySelector('#micPreGain'),
  micPreGainValue: document.querySelector('#micPreGainValue'),
  micSettingsSummary: document.querySelector('#micSettingsSummary'),
  micAutoGainControl: document.querySelector('#micAutoGainControl'),
  micLevel: document.querySelector('.mic-level'),
  micLevelFill: document.querySelector('#micLevelFill'),
  audioSettingsReset: document.querySelector('#audioSettingsReset'),
  ttsOutputState: document.querySelector('#ttsOutputState'),
  ttsOutputDetail: document.querySelector('#ttsOutputDetail'),
};

const initialLanes = buildLocalLanes('Dutch', 'English');

const state = {
  socket: null,
  capture: null,
  listening: false,
  finalizing: false,
  sideALanguage: 'Dutch',
  sideBLanguage: 'English',
  requestedStartLaneId: 'a_to_b',
  lanes: initialLanes,
  currentTurn: createLocalTurn('a_to_b', initialLanes),
  audioStatus: '',
  status: 'idle',
  captureMutedForPlayback: false,
  settingsPage: 'home',
  vadHintTimer: null,
  audioSettings: {
    preGain: 1,
    autoGainControl: false,
    inputLevel: 0,
  },
};

let audioQueue;

audioQueue = new AudioQueue({
  audio: els.ttsAudio,
  resumeButton: els.audioResumeButton,
  onStatus: (text) => {
    state.audioStatus = text;
    if (text) {
      els.miniStatus.textContent = text;
      if (text.startsWith('Playing')) renderStatus('speaking');
    } else if (state.listening) {
      renderStatus('listening');
    } else if (!state.finalizing && state.status === 'speaking') {
      renderStatus('idle');
    }
    updateActionButtons();
  },
  onPlaybackStart: () => {
    state.captureMutedForPlayback = true;
    renderStatus('speaking');
  },
  onPlaybackIdle: () => {
    state.captureMutedForPlayback = false;
    renderStatus(state.listening ? 'listening' : state.status);
  },
  onItemEnded: (item) => {
    state.socket?.ttsPlaybackComplete({
      laneId: item.laneId,
      turnId: item.turnId,
      artifactId: item.artifactId,
    });
  },
});

init().catch((error) => {
  setStatus('error', error.message || String(error));
});

async function init() {
  const config = await api.getConfig();
  state.sideALanguage = normalizeLanguageName(config.conversation?.side_a_language || 'Dutch');
  state.sideBLanguage = normalizeLanguageName(config.conversation?.side_b_language || 'English');
  state.lanes = buildLocalLanes(state.sideALanguage, state.sideBLanguage);
  renderTtsOutputState(config.tts);

  els.listenButton.addEventListener('click', () => {
    if (state.listening || state.finalizing) {
      pauseListening();
    } else {
      startListening();
    }
  });
  els.sourceLanguageChip.addEventListener('click', () => openLanguageSheet('source'));
  els.targetLanguageChip.addEventListener('click', () => openLanguageSheet('target'));
  els.swapButton.addEventListener('click', swapDirection);
  els.speakNowButton.addEventListener('click', speakNow);
  els.clearTurnButton.addEventListener('click', clearTurn);
  els.settingsButton.addEventListener('click', openSettingsSheet);
  els.settingsBackButton.addEventListener('click', handleSettingsBack);
  els.settingsMicrophoneNav.addEventListener('click', () => setSettingsPage('microphone'));
  els.settingsAudioNav.addEventListener('click', () => setSettingsPage('audio'));
  els.micPreGain.addEventListener('input', handlePreGainInput);
  els.micAutoGainControl.addEventListener('change', handleAutoGainControlChange);
  els.audioSettingsReset.addEventListener('click', resetAudioSettings);
  els.languageSheetScrim.addEventListener('click', closeLanguageSheet);
  els.languageSheetClose.addEventListener('click', closeLanguageSheet);
  els.settingsSheetScrim.addEventListener('click', closeSettingsSheet);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeLanguageSheet();
    closeSettingsSheet();
  });

  renderLanguageChips();
  setupAutoFollow(els.sourceText);
  setupAutoFollow(els.targetText);
  renderTranscript();
  renderAudioSettings();
  updateActionButtons();
  setStatus('idle', '');
}

async function startListening({ statusDetail = 'Opening connection' } = {}) {
  const startLaneId = currentLaneId();
  clearAllLanes({ laneId: startLaneId });
  state.requestedStartLaneId = startLaneId;
  setListenBusy(true);
  setStatus('connecting', statusDetail);
  try {
    const session = await api.createSession({
      sideALanguage: state.sideALanguage,
      sideBLanguage: state.sideBLanguage,
    });
    const socket = new SessionSocket(
      session.ws_url,
      handleMessage,
      () => {
        if (state.socket !== socket) return;
        if (state.finalizing) return;
        state.listening = false;
        state.captureMutedForPlayback = false;
        renderAudioSettings();
        updateListenButton();
        setStatus('idle', '');
      },
    );
    await socket.connect();
    state.socket = socket;
    state.socket.startListening();
    state.listening = true;
    state.finalizing = false;
    state.capture = new AudioCapture({
      targetSampleRate: session.audio_input?.sample_rate_hz || 16000,
      chunkMs: 40,
      preGain: state.audioSettings.preGain,
      autoGainControl: state.audioSettings.autoGainControl,
      onChunk: (buffer) => {
        if (shouldSendMicrophoneAudio()) state.socket?.sendAudio(buffer);
      },
      onLevel: (level) => renderMicLevel(level),
    });
    await state.capture.start();
    renderAudioSettings();
    setStatus('listening', '');
  } catch (error) {
    state.listening = false;
    state.finalizing = false;
    state.captureMutedForPlayback = false;
    cleanupClientSession();
    setStatus('error', error.message || String(error));
  } finally {
    setListenBusy(false);
    updateListenButton();
  }
}

function pauseListening() {
  if (!state.socket?.isOpen()) {
    cleanupClientSession();
    return;
  }
  state.finalizing = true;
  state.listening = false;
  state.captureMutedForPlayback = false;
  state.capture?.stop();
  state.capture = null;
  renderMicLevel(0);
  renderAudioSettings();
  state.socket.pauseListening();
  setStatus('finalizing', 'Finalizing');
  updateListenButton();
}

function speakNow() {
  if (audioQueue.hasAudio()) {
    audioQueue.playOrResume();
    return;
  }
  if (state.currentTurn.speakableTargetText && state.currentTurn.state !== TURN_STATES.OPEN_SPEAKING && state.socket?.speakNow()) {
    els.miniStatus.textContent = 'Creating audio';
  }
}

function clearTurn() {
  if (state.finalizing) return;
  if (state.socket?.clearTurn()) {
    audioQueue.clear();
    els.miniStatus.textContent = 'Clearing turn';
  }
}

function shouldSendMicrophoneAudio() {
  return !state.captureMutedForPlayback && state.currentTurn.state !== TURN_STATES.OPEN_SPEAKING;
}

function swapDirection() {
  const nextLaneId = currentLaneId() === 'a_to_b' ? 'b_to_a' : 'a_to_b';
  if (state.finalizing) {
    els.miniStatus.textContent = 'Wait until finalizing is done';
    return;
  }
  if (state.socket?.isOpen()) {
    audioQueue.clear();
    state.socket.nextTurn(nextLaneId);
    els.miniStatus.textContent = 'Switching direction';
    return;
  }
  audioQueue.clear();
  state.currentTurn = createLocalTurn(nextLaneId, state.lanes);
  enableTranscriptAutoFollow();
  renderLanguageChips();
  renderTranscript();
  updateActionButtons();
  els.miniStatus.textContent = directionLabel();
}

function handleMessage(msg) {
  if (msg.type === 'ready') {
    applyReady(msg);
    return;
  }
  if (msg.type === 'state') {
    setStatus(msg.state || 'idle', statusLabel(msg.state));
    return;
  }
  if (msg.type === 'vad_state') {
    handleVadState(msg);
    return;
  }
  if (msg.type === 'turn_update') {
    applyTurnUpdate(msg);
    return;
  }
  if (msg.type === 'tts_clip_ready') {
    if (!shouldApplyCurrentTurnMessage(msg)) return;
    if (msg.tts) {
      audioQueue.enqueue({
        ...msg.tts,
        laneId: msg.lane_id,
        turnId: msg.turn_id,
        artifactId: msg.tts.artifact_id,
      });
      els.miniStatus.textContent = 'Audio ready';
    }
    updateActionButtons();
    return;
  }
  if (msg.type === 'tts_status') {
    els.miniStatus.textContent = msg.message || msg.reason || '';
    updateActionButtons();
    return;
  }
  if (msg.type === 'asr_status') {
    if (!els.miniStatus.textContent) {
      els.miniStatus.textContent = 'Processing speech';
    }
    return;
  }
  if (msg.type === 'error') {
    setStatus('error', msg.message || msg.code || 'Error');
    return;
  }
  if (msg.type === 'ended') {
    state.finalizing = false;
    state.listening = false;
    state.captureMutedForPlayback = false;
    hideVadHint();
    cleanupClientSession({ keepSocket: false });
    setStatus('idle', audioQueue.statusText());
    updateListenButton();
    updateActionButtons();
  }
}

function applyReady(msg) {
  state.sideALanguage = normalizeLanguageName(msg.side_a_language || state.sideALanguage);
  state.sideBLanguage = normalizeLanguageName(msg.side_b_language || state.sideBLanguage);
  state.lanes = buildLocalLanes(state.sideALanguage, state.sideBLanguage);
  for (const laneId of Object.keys(msg.lanes || {})) {
    mergeLanePayload(laneId, msg.lanes[laneId]);
  }
  applyCurrentTurn(msg.current_turn || createLocalTurn('a_to_b', state.lanes));
  hideVadHint();
  enableTranscriptAutoFollow();
  renderLanguageChips();
  renderTranscript();
  updateActionButtons();
  els.miniStatus.textContent = directionLabel();
  if (state.requestedStartLaneId !== currentLaneId()) {
    state.socket?.nextTurn(state.requestedStartLaneId);
  }
}

function applyTurnUpdate(msg) {
  for (const laneId of Object.keys(msg.lanes || {})) {
    mergeLanePayload(laneId, msg.lanes[laneId]);
  }
  const previousLaneId = currentLaneId();
  applyCurrentTurn(msg.current_turn || state.currentTurn);
  const laneChanged = previousLaneId !== currentLaneId();
  if (laneChanged || msg.reason === 'clear_turn' || msg.reason === 'next_turn') {
    audioQueue.clear();
    hideVadHint();
    enableTranscriptAutoFollow();
  }
  renderLanguageChips();
  renderTranscript();
  updateActionButtons();
  renderTurnStatus(msg.reason);
}

function applyCurrentTurn(payload) {
  state.currentTurn = normalizeTurnPayload(payload);
}

function renderTurnStatus(reason) {
  if (state.audioStatus) return;
  if (reason === 'source_c') {
    els.miniStatus.textContent = 'Translating';
  } else if (reason === 'translation_update') {
    els.miniStatus.textContent = 'Translation ready';
  } else if (reason === 'speak_now') {
    els.miniStatus.textContent = 'Creating audio';
  } else if (reason === 'clear_turn') {
    els.miniStatus.textContent = 'Turn cleared';
  } else if (reason === 'next_turn' || reason === 'tts_playback_complete') {
    els.miniStatus.textContent = directionLabel();
  }
}

function cleanupClientSession({ keepSocket = false } = {}) {
  state.capture?.stop();
  state.capture = null;
  state.captureMutedForPlayback = false;
  hideVadHint();
  renderMicLevel(0);
  renderAudioSettings();
  if (!keepSocket) {
    state.socket?.close();
    state.socket = null;
  }
}

function clearAllLanes({ laneId = currentLaneId() } = {}) {
  state.lanes = buildLocalLanes(state.sideALanguage, state.sideBLanguage);
  state.currentTurn = createLocalTurn(laneId, state.lanes);
  els.miniStatus.textContent = '';
  audioQueue.clear();
  hideVadHint();
  enableTranscriptAutoFollow();
  renderTranscript();
  updateActionButtons();
}

function setListenBusy(busy) {
  els.listenButton.disabled = Boolean(busy);
}

function updateListenButton() {
  renderStatus(state.finalizing ? 'finalizing' : state.listening ? 'listening' : state.status);
}

function updateActionButtons() {
  updateSpeakNowButton();
  updateClearTurnButton();
  renderLanguageChips();
}

function updateSpeakNowButton() {
  const turnIsSpeaking = state.currentTurn.state === TURN_STATES.OPEN_SPEAKING;
  const canSpeakTarget = Boolean(state.currentTurn.speakableTargetText && state.socket?.isOpen() && !turnIsSpeaking);
  const canPlayAudio = Boolean(audioQueue?.hasAudio() && state.socket?.isOpen());
  els.speakNowButton.disabled = !(canSpeakTarget || canPlayAudio) || state.finalizing;
  els.speakNowButton.classList.toggle('is-busy', state.finalizing || turnIsSpeaking);
  if (state.finalizing) {
    els.speakNowButton.textContent = 'Finalizing...';
  } else if (state.audioStatus.startsWith('Playing')) {
    els.speakNowButton.textContent = 'Playing...';
  } else if (canPlayAudio) {
    els.speakNowButton.textContent = 'Play audio';
  } else {
    els.speakNowButton.textContent = 'Speak now';
  }
}

function updateClearTurnButton() {
  const hasText = Boolean(state.currentTurn.sourceText || state.currentTurn.targetText || state.currentTurn.parts.length);
  els.clearTurnButton.disabled = state.finalizing || !hasText || !state.socket?.isOpen();
}

function setStatus(status, detail) {
  state.status = String(status || 'idle').toLowerCase();
  renderStatus(state.status);
  els.miniStatus.textContent = detail || '';
  updateActionButtons();
}

function renderStatus(status) {
  const normalized = String(status || 'idle').toLowerCase();
  els.listenButton.className = 'status-pill';
  if (normalized === 'listening') els.listenButton.classList.add('is-listening');
  if (normalized === 'finalizing') els.listenButton.classList.add('is-finalizing');
  if (normalized === 'speaking') els.listenButton.classList.add('is-speaking');
  if (normalized === 'error') els.listenButton.classList.add('is-error');
  els.listenButton.textContent = statusLabel(normalized);
}

function statusLabel(status) {
  const normalized = String(status || 'idle').toLowerCase();
  if (normalized === 'listening') return 'stop';
  if (normalized === 'finalizing') return 'wait';
  if (normalized === 'connecting') return 'opening';
  if (normalized === 'speaking') return 'playing';
  if (normalized === 'error') return 'error';
  return 'start';
}

function openLanguageSheet(role) {
  if (state.listening || state.finalizing) {
    els.miniStatus.textContent = 'Languages are locked while live';
    return;
  }
  els.languageSheetTitle.textContent = role === 'source' ? 'Choose source language' : 'Choose target language';
  renderLanguageOptions(role);
  els.languageSheet.hidden = false;
}

function closeLanguageSheet() {
  els.languageSheet.hidden = true;
}

function renderLanguageOptions(role) {
  const lane = currentLane();
  const current = role === 'source' ? lane.sourceLanguage : lane.targetLanguage;
  const recent = uniqueLanguages([current, 'English', 'Dutch', 'German']);
  const recentGroup = createLanguageGroup('Recent', recent, current, role);
  const allGroup = createLanguageGroup('All languages', languages.map((item) => item.name), current, role);
  els.languageOptions.replaceChildren(recentGroup, allGroup);
}

function createLanguageGroup(title, names, current, role) {
  const group = document.createElement('section');
  group.className = 'option-group';

  const heading = document.createElement('h3');
  heading.textContent = title;
  group.append(heading);

  for (const name of names) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'language-option';
    if (name === current) button.classList.add('is-selected');
    button.addEventListener('click', () => {
      closeLanguageSheet();
      if (name === current) return;
      setVisibleLanguage(role, name);
    });

    const label = document.createElement('span');
    label.textContent = name;
    const code = document.createElement('span');
    code.className = 'language-code';
    code.textContent = codeForLanguage(name);
    button.append(label, code);
    group.append(button);
  }

  return group;
}

function openSettingsSheet() {
  setSettingsPage('home');
  renderAudioSettings();
  els.settingsSheet.hidden = false;
}

function closeSettingsSheet() {
  els.settingsSheet.hidden = true;
}

function handleSettingsBack() {
  if (state.settingsPage === 'home') {
    closeSettingsSheet();
    return;
  }
  setSettingsPage('home');
}

function setSettingsPage(page) {
  state.settingsPage = page === 'microphone' || page === 'audio' ? page : 'home';
  renderSettingsPage();
}

function renderSettingsPage() {
  const page = state.settingsPage;
  els.settingsHomePage.hidden = page !== 'home';
  els.settingsMicrophonePage.hidden = page !== 'microphone';
  els.settingsAudioPage.hidden = page !== 'audio';
  if (page === 'microphone') {
    els.settingsSheetTitle.textContent = 'Microphone';
  } else if (page === 'audio') {
    els.settingsSheetTitle.textContent = 'Audio output';
  } else {
    els.settingsSheetTitle.textContent = 'Settings';
  }
}

function setVisibleLanguage(role, value) {
  const next = normalizeLanguageName(value);
  if (currentLaneId() === 'a_to_b') {
    if (role === 'source') state.sideALanguage = next;
    else state.sideBLanguage = next;
  } else if (role === 'source') {
    state.sideBLanguage = next;
  } else {
    state.sideALanguage = next;
  }
  state.lanes = buildLocalLanes(state.sideALanguage, state.sideBLanguage);
  state.currentTurn = createLocalTurn(currentLaneId(), state.lanes);
  renderLanguageChips();
  renderTranscript();
  updateActionButtons();
  els.miniStatus.textContent = directionLabel();
}

function handlePreGainInput() {
  state.audioSettings.preGain = normalizePreGain(els.micPreGain.value);
  state.capture?.setPreGain(state.audioSettings.preGain);
  renderAudioSettings();
}

function handleAutoGainControlChange() {
  if (state.listening || state.finalizing) {
    renderAudioSettings();
    return;
  }
  state.audioSettings.autoGainControl = Boolean(els.micAutoGainControl.checked);
  renderAudioSettings();
}

function resetAudioSettings() {
  if ((state.listening || state.finalizing) && state.audioSettings.autoGainControl) return;
  state.audioSettings.preGain = 1;
  if (!state.listening && !state.finalizing) {
    state.audioSettings.autoGainControl = false;
  }
  state.capture?.setPreGain(state.audioSettings.preGain);
  renderAudioSettings();
}

function renderAudioSettings() {
  els.micPreGain.value = String(state.audioSettings.preGain);
  const preGainLabel = `${state.audioSettings.preGain.toFixed(1)}x`;
  els.micPreGainValue.textContent = preGainLabel;
  els.micSettingsSummary.textContent = preGainLabel;
  els.micAutoGainControl.checked = state.audioSettings.autoGainControl;
  els.micAutoGainControl.disabled = state.listening || state.finalizing;
  els.audioSettingsReset.disabled = Boolean((state.listening || state.finalizing) && state.audioSettings.autoGainControl);
  renderMicLevel(state.audioSettings.inputLevel);
}

function renderTtsOutputState(tts) {
  let label = 'off';
  if (!tts?.enabled) {
    label = 'off';
  } else {
    const backend = String(tts.backend || '').trim();
    label = backend ? `on (${backend})` : 'on';
  }
  els.ttsOutputState.textContent = label;
  els.ttsOutputDetail.textContent = label;
}

function handleVadState(msg) {
  if (!shouldApplyCurrentTurnMessage(msg)) return;
  if (!state.listening) {
    hideVadHint();
    return;
  }
  if (msg.speech_detected !== true) {
    hideVadHint();
    return;
  }
  showVadHint();
}

function showVadHint() {
  els.vadBadge.hidden = false;
  if (state.vadHintTimer) {
    clearTimeout(state.vadHintTimer);
  }
  state.vadHintTimer = setTimeout(() => {
    state.vadHintTimer = null;
    hideVadHint();
  }, 900);
}

function hideVadHint() {
  if (state.vadHintTimer) {
    clearTimeout(state.vadHintTimer);
    state.vadHintTimer = null;
  }
  els.vadBadge.hidden = true;
}

function renderMicLevel(value) {
  const level = normalizeLevel(value);
  state.audioSettings.inputLevel = level;
  const percent = Math.round(level * 100);
  els.micLevelFill.style.transform = `scaleX(${level.toFixed(3)})`;
  els.micLevel.setAttribute('aria-valuenow', String(percent));
  els.micLevel.classList.toggle('is-hot', level >= 0.9);
}

function renderLanguageChips() {
  const lane = currentLane();
  const locked = state.listening || state.finalizing;
  els.sourceLanguageCode.textContent = codeForLanguage(lane.sourceLanguage);
  els.targetLanguageCode.textContent = codeForLanguage(lane.targetLanguage);
  els.sourceLanguageChip.disabled = locked;
  els.targetLanguageChip.disabled = locked;
  els.sourceLanguageChip.setAttribute('aria-label', `Source language: ${lane.sourceLanguage}`);
  els.targetLanguageChip.setAttribute('aria-label', `Target language: ${lane.targetLanguage}`);
}

function renderTranscript() {
  const lane = currentLane();
  renderTurnStream(els.sourceText, state.currentTurn.parts, 'source', state.currentTurn.sourceText);
  renderTurnStream(els.targetText, state.currentTurn.parts, 'target', state.currentTurn.targetText);
  els.sourcePaneMeta.textContent = codeForLanguage(lane.sourceLanguage);
  els.targetPaneMeta.textContent = codeForLanguage(lane.targetLanguage);
  pinToBottomIfFollowing(els.sourceText);
  pinToBottomIfFollowing(els.targetText);
}

function renderTurnStream(el, parts, role, fallbackText) {
  const fragment = document.createDocumentFragment();
  for (const part of parts || []) {
    const committedText = role === 'source' ? part.sourceCommittedText : part.targetCommittedText;
    const previewText = role === 'source' ? part.sourcePreviewText : part.targetPreviewText;
    if (!visibleText(committedText, previewText)) continue;
    const row = document.createElement('div');
    row.className = 'turn-part';
    if (part.speechState === 'spoken') row.classList.add('is-spoken');
    if (part.speechState === 'speaking') row.classList.add('is-speaking');
    renderTextStream(row, committedText, previewText);
    fragment.append(row);
  }
  if (!fragment.childNodes.length && fallbackText) {
    const row = document.createElement('div');
    row.className = 'turn-part';
    row.textContent = String(fallbackText || '');
    fragment.append(row);
  }
  el.replaceChildren(fragment);
}

function renderTextStream(el, committed, preview) {
  const committedText = String(committed || '');
  const previewText = previewSuffixText(committedText, preview);
  if (!committedText && !previewText) {
    el.replaceChildren();
    return;
  }
  const committedSpan = document.createElement('span');
  committedSpan.className = 'text-committed';
  committedSpan.textContent = committedText;
  const previewSpan = document.createElement('span');
  previewSpan.className = 'text-preview';
  previewSpan.textContent = previewText;
  el.replaceChildren(committedSpan, previewSpan);
}

function buildLocalLanes(sideALanguage, sideBLanguage) {
  return {
    a_to_b: createLane('a_to_b', sideALanguage, sideBLanguage),
    b_to_a: createLane('b_to_a', sideBLanguage, sideALanguage),
  };
}

function createLane(laneId, sourceLanguage, targetLanguage) {
  return {
    laneId,
    sourceLanguage,
    targetLanguage,
  };
}

function createLocalTurn(laneId, lanes) {
  const safeLaneId = LANE_IDS.includes(laneId) ? laneId : 'a_to_b';
  const lane = lanes?.[safeLaneId] || createLane(safeLaneId, 'Dutch', 'English');
  return {
    turnId: '',
    laneId: safeLaneId,
    direction: `${lane.sourceLanguage}->${lane.targetLanguage}`,
    state: TURN_STATES.OPEN_EMPTY,
    sourceLanguage: lane.sourceLanguage,
    targetLanguage: lane.targetLanguage,
    sourceText: '',
    targetText: '',
    speakableTargetText: '',
    canSpeakNow: false,
    parts: [],
  };
}

function normalizeTurnPayload(payload) {
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

function mergeLanePayload(laneId, payload) {
  const lane = ensureLane(laneId);
  lane.sourceLanguage = normalizeLanguageName(payload.source_language || lane.sourceLanguage);
  lane.targetLanguage = normalizeLanguageName(payload.target_language || lane.targetLanguage);
}

function shouldApplyCurrentTurnMessage(msg) {
  const laneId = String(msg.lane_id || '').trim();
  if (laneId && laneId !== currentLaneId()) return false;
  const msgTurnId = String(msg.turn_id || '').trim();
  if (!msgTurnId) return true;
  return msgTurnId === state.currentTurn.turnId;
}

function ensureLane(laneId) {
  const safeLaneId = LANE_IDS.includes(laneId) ? laneId : currentLaneId();
  if (!state.lanes[safeLaneId]) {
    state.lanes[safeLaneId] = createLane(safeLaneId, state.sideALanguage, state.sideBLanguage);
  }
  return state.lanes[safeLaneId];
}

function currentLaneId() {
  return LANE_IDS.includes(state.currentTurn?.laneId) ? state.currentTurn.laneId : 'a_to_b';
}

function currentLane() {
  return ensureLane(currentLaneId());
}

function visibleText(committed, preview) {
  const left = String(committed || '').trim();
  const right = String(preview || '').trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

function previewSuffixText(committed, preview) {
  const left = String(committed || '');
  const right = String(preview || '').trim();
  if (!right) return '';
  return /\s$/.test(left) || !left ? right : ` ${right}`;
}

function directionLabel() {
  const lane = currentLane();
  return `${codeForLanguage(lane.sourceLanguage)} -> ${codeForLanguage(lane.targetLanguage)}`;
}

function normalizePreGain(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0.5, Math.min(3.0, numeric)) : 1;
}

function normalizeLevel(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

function normalizeLanguageName(value) {
  const fallback = languages[0]?.name || 'English';
  const text = String(value || '').trim();
  return languages.some((item) => item.name === text) ? text : fallback;
}

function codeForLanguage(name) {
  const match = languages.find((item) => item.name === name);
  return (match?.asr || String(name || '').slice(0, 2)).toUpperCase();
}

function uniqueLanguages(names) {
  return names.filter((name, index) => names.indexOf(name) === index && languages.some((item) => item.name === name));
}

function setupAutoFollow(el) {
  if (!el) return;
  enableAutoFollow(el);
  el.addEventListener('scroll', () => {
    el.dataset.autofollow = isNearBottom(el) ? 'on' : 'off';
  });
}

function enableTranscriptAutoFollow() {
  enableAutoFollow(els.sourceText);
  enableAutoFollow(els.targetText);
}

function enableAutoFollow(el) {
  if (el) el.dataset.autofollow = 'on';
}

function pinToBottomIfFollowing(el) {
  if (!el || el.dataset.autofollow === 'off') return;
  el.scrollTop = el.scrollHeight;
  requestAnimationFrame(() => {
    if (el.dataset.autofollow !== 'off') el.scrollTop = el.scrollHeight;
  });
}

function isNearBottom(el) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
}
