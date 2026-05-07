# Translate Now Design

This note defines the manual translation action for the turn-based live
translation workflow.

## Intent

`Translate now` is a source-side action. It means:

```text
The source text currently visible to the backend for the active lane/current
turn is good enough to translate now.
```

It is separate from `Speak now`, which remains a target-side action for TTS or
queued audio playback.

## Runtime Semantics

When the backend receives `translate_now`:

- it applies the command to the active lane/current turn at receive time
- it uses the source preview known to the backend at that moment
- it closes the current ASR scope for that turn
- it accepts the visible source preview as committed source text
- it retires/cancels current translation work for that lane best-effort
- it dispatches a new translation request for the accepted source state
- late translation results from older translation work are ignored

The frontend click-time source snapshot and the backend receive-time source
snapshot can differ. This race is accepted explicitly; no frontend source
revision or text snapshot is sent with the command.

## UI

During `RUNNING`, the bottom action dock has separate actions:

```text
[settings]  [Translate now]  [Speak now]  [Mic off / Finish]
```

`Translate now` is enabled when the active turn has visible source preview text
that has not yet been accepted as committed source text. It does not start TTS.

`Speak now` is enabled when the active turn has target text or queued audio that
has not yet been spoken. It does not force new source translation.
