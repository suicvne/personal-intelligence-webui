// A button that reads something aloud. While it does, it shows progress (generating the speech can take a
// while) and then Stop; a failure is shown below it.
import { Square, Volume2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { SpeechPlayer } from "../state/speech_player.ts";
import { Spinner } from "./controls.tsx";

export function useSpeech(player: SpeechPlayer) {
  return useSyncExternalStore(player.Subscribe, player.Snapshot);
}

export function SpeechButton({ title, player, speak }: { title: string; player: SpeechPlayer; speak: () => void }) {
  const { state, failure } = useSpeech(player);
  return (
    <div className="speech">
      <div className="row">
        {state === "idle" && (
          <button type="button" className="button small" onClick={speak}><Volume2 aria-hidden />{title}</button>
        )}
        {state === "preparing" && (
          <>
            <Spinner label="Preparing the voice" />
            <span className="muted">Preparing the voice…</span>
            <button type="button" className="button small ghost" onClick={() => player.Stop()}>Cancel</button>
          </>
        )}
        {state === "playing" && (
          <button type="button" className="button small" onClick={() => player.Stop()}><Square aria-hidden />Stop</button>
        )}
      </div>
      {failure && <p className="caption warning">{failure}</p>}
    </div>
  );
}
