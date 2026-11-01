import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { PASEO_MUSIC } from "./shared/paseo";

const COMPLETION_EVENTS = new Set(["turn_completed", "turn_failed"]);
const STORAGE_KEY = "paseo-notify.sound.v1";
const MAX_FILE_BYTES = 12 * 1024 * 1024;
type AudioSource = { base64: string; mimeType: string };

function loadSavedSound(): AudioSource | null {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    if (
      typeof parsed === "object" && parsed !== null &&
      "base64" in parsed && typeof parsed.base64 === "string" &&
      "mimeType" in parsed && typeof parsed.mimeType === "string"
    ) return { base64: parsed.base64, mimeType: parsed.mimeType };
  } catch (error) {
    console.warn("Paseo Notify could not read its saved sound:", error);
  }
  return null;
}

function SoundDashboard({ play }: PluginSurfaceProps & { play(source: AudioSource): void }) {
  const [savedSound, setSavedSound] = useState<AudioSource | null>(loadSavedSound);
  const [fileName, setFileName] = useState(() => {
    try { return globalThis.localStorage?.getItem(STORAGE_KEY + ".name") ?? "Paseo.mp3"; }
    catch { return "Paseo.mp3"; }
  });
  const [error, setError] = useState<string | null>(null);

  const pickSound = (): void => {
    if (typeof document === "undefined") {
      setError("Sound file picking is available in the Paseo desktop client.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.webm";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        setError("Choose a sound smaller than 12 MB.");
        return;
      }
      if (!file.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(file.name)) {
        setError("Choose an audio file.");
        return;
      }
      void file.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        const source = { base64: btoa(binary), mimeType: file.type || "audio/mpeg" };
        try {
          globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(source));
          globalThis.localStorage?.setItem(STORAGE_KEY + ".name", file.name);
          setSavedSound(source);
          setFileName(file.name);
          setError(null);
        } catch {
          setError("This sound could not be saved in this client. Try a smaller audio file.");
        }
      }).catch(() => setError("Could not read that audio file."));
    };
    input.click();
  };

  const resetSound = (): void => {
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
      globalThis.localStorage?.removeItem(STORAGE_KEY + ".name");
      setSavedSound(null);
      setFileName("Paseo.mp3");
      setError(null);
    } catch { setError("Could not reset the saved sound."); }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.heading}>Completion sound</Text>
      <Text style={styles.body}>Choose an audio file to play on this Paseo client when an agent finishes or fails. Your choice is saved on this device.</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Current sound</Text>
        <Text style={styles.fileName}>{savedSound ? fileName : "Paseo.mp3 (built in)"}</Text>
        <Text style={styles.hint}>MP3, WAV, OGG, M4A, AAC, FLAC, OPUS, or WEBM · up to 12 MB</Text>
        <Pressable accessibilityRole="button" onPress={pickSound} style={styles.primaryButton}>
          <Text style={styles.primaryText}>Choose audio file…</Text>
        </Pressable>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => play(savedSound ?? PASEO_MUSIC)} style={styles.button}>
            <Text style={styles.buttonText}>Test sound</Text>
          </Pressable>
          {savedSound ? <Pressable accessibilityRole="button" onPress={resetSound} style={styles.button}>
            <Text style={styles.buttonText}>Use built-in sound</Text>
          </Pressable> : null}
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16 },
  heading: { fontSize: 22, fontWeight: "700", color: "#f4f4f5" },
  body: { fontSize: 14, lineHeight: 21, color: "#a1a1aa" },
  card: { padding: 18, borderRadius: 12, gap: 12, backgroundColor: "#18181b" },
  label: { fontSize: 13, fontWeight: "600", color: "#a1a1aa" },
  fileName: { fontSize: 16, fontWeight: "600", color: "#fafafa" },
  hint: { fontSize: 12, color: "#a1a1aa" },
  primaryButton: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: "#6366f1" },
  primaryText: { color: "white", fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  button: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: "#27272a" },
  buttonText: { color: "#e4e4e7", fontWeight: "500" },
  error: { fontSize: 13, color: "#f87171" },
});

export default function contribute(client: PluginClientContext): () => void {
  let stopped = false;
  let directorySubscription: import("@getpaseo/client").OwnedSubscription<import("@getpaseo/client").PaseoAgentListResult> | undefined;
  const timelineSubscriptions = new Map<string, import("@getpaseo/client").PaseoAgentTimelineSubscription>();
  let playbackQueue: Promise<void> = Promise.resolve();
  const playSound = (source: AudioSource, label: string): void => {
    playbackQueue = playbackQueue.then(async () => {
      if (!stopped) await client.playAudio(source);
    }).catch((error: unknown) => console.error("Paseo Notify could not play its sound for " + label + ":", error));
  };
  const dashboard = client.addScreen({
    id: "dashboard",
    title: "Paseo Notify",
    Component: (props) => <SoundDashboard {...props} play={(source) => playSound(source, "dashboard preview")} />,
  });
  const sidebar = client.addSidebarHeaderItem({
    id: "dashboard",
    title: "Paseo Notify",
    Component: ({ openScreen }) => <Pressable accessibilityRole="button" onPress={() => openScreen({ screenId: "dashboard" })} style={{ padding: 12 }}><Text style={{ color: "#e4e4e7" }}>Paseo Notify</Text></Pressable>,
  });
  const settings = client.addSettingsScreen({
    id: "settings",
    title: "Paseo Notify settings",
    icon: "Volume2",
    Component: (props) => <SoundDashboard {...props} play={(source) => playSound(source, "settings preview")} />,
  });
  const removeTestCommand = client.addCommandCenterItem({
    id: "test-sound", title: "Test Paseo Notify sound", icon: "Volume2", context: "global",
    onSelect: () => playSound(loadSavedSound() ?? PASEO_MUSIC, "test playback"),
  });
  const detachAgent = (agentId: string): void => {
    const subscription = timelineSubscriptions.get(agentId);
    if (!subscription) return;
    timelineSubscriptions.delete(agentId);
    void subscription.release().catch((error: unknown) => console.error("Paseo Notify could not release timeline subscription for " + agentId + ":", error));
  };
  const attachAgent = (agentId: string): void => {
    if (stopped || timelineSubscriptions.has(agentId)) return;
    const subscription = client.paseo.agents.ref(agentId).timeline.subscribe(({ event }) => {
      if (COMPLETION_EVENTS.has(event.type)) playSound(loadSavedSound() ?? PASEO_MUSIC, "agent " + agentId);
    });
    timelineSubscriptions.set(agentId, subscription);
    void subscription.ready.catch((error: unknown) => {
      if (timelineSubscriptions.get(agentId) === subscription) timelineSubscriptions.delete(agentId);
      console.error("Paseo Notify could not listen to agent " + agentId + ":", error);
    });
  };
  const start = async (): Promise<void> => {
    const directory = await client.paseo.agents.list({ includeBackground: true, filter: { includeArchived: false, includeBackground: true }, subscribe: {} });
    const subscription = directory.subscription;
    if (!subscription) throw new Error("Paseo did not create an agent directory subscription");
    if (stopped) { await subscription.release(); return; }
    directorySubscription = subscription;
    for (const entry of directory.entries) attachAgent(entry.agent.id);
    subscription.subscribe({
      snapshot({ entries }) { for (const entry of entries) attachAgent(entry.agent.id); },
      update(message) {
        if (message.type !== "agent_update") return;
        const update = message.payload;
        if (update.kind === "upsert") attachAgent(update.agent.id);
        if (update.kind === "remove") detachAgent(update.agentId);
      },
      error(error) { console.error("Paseo Notify agent directory listener failed:", error); },
    });
  };
  void start().catch((error: unknown) => { if (!stopped) console.error("Paseo Notify could not start its client listener:", error); });
  return () => {
    stopped = true;
    dashboard(); sidebar(); settings(); removeTestCommand();
    const directory = directorySubscription;
    directorySubscription = undefined;
    if (directory) void directory.release().catch((error: unknown) => console.error("Paseo Notify could not release the agent directory listener:", error));
    for (const agentId of timelineSubscriptions.keys()) detachAgent(agentId);
  };
}
