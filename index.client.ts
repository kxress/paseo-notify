import type {
  OwnedSubscription,
  PaseoAgentListResult,
  PaseoAgentTimelineSubscription,
} from "@getpaseo/client";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PASEO_MUSIC } from "./shared/paseo";

const COMPLETION_EVENTS = new Set(["turn_completed", "turn_failed"]);

export default function contribute(client: PluginClientContext): () => void {
  let stopped = false;
  let directorySubscription: OwnedSubscription<PaseoAgentListResult> | undefined;
  const timelineSubscriptions = new Map<string, PaseoAgentTimelineSubscription>();
  let playbackQueue: Promise<void> = Promise.resolve();

  const playSound = (label: string): void => {
    playbackQueue = playbackQueue
      .then(async () => {
        if (!stopped) await client.playAudio(PASEO_MUSIC);
      })
      .catch((error: unknown) => {
        console.error("Paseo Ear could not play its sound for " + label + ":", error);
      });
  };

  const removeTestCommand = client.addCommandCenterItem({
    id: "test-sound",
    title: "Test Paseo Ear sound",
    icon: "Volume2",
    context: "global",
    onSelect: () => playSound("test playback"),
  });

  const playChime = (agentId: string): void => {
    playSound("agent " + agentId);
  };

  const detachAgent = (agentId: string): void => {
    const subscription = timelineSubscriptions.get(agentId);
    if (!subscription) return;
    timelineSubscriptions.delete(agentId);
    void subscription.release().catch((error: unknown) => {
      console.error("Paseo Ear could not release timeline subscription for " + agentId + ":", error);
    });
  };

  const attachAgent = (agentId: string): void => {
    if (stopped || timelineSubscriptions.has(agentId)) return;

    const subscription = client.paseo.agents.ref(agentId).timeline.subscribe(({ event }) => {
      if (COMPLETION_EVENTS.has(event.type)) playChime(agentId);
    });
    timelineSubscriptions.set(agentId, subscription);
    void subscription.ready.catch((error: unknown) => {
      if (timelineSubscriptions.get(agentId) === subscription) {
        timelineSubscriptions.delete(agentId);
      }
      console.error("Paseo Ear could not listen to agent " + agentId + ":", error);
    });
  };

  const start = async (): Promise<void> => {
    const directory = await client.paseo.agents.list({
      includeBackground: true,
      filter: { includeArchived: false, includeBackground: true },
      subscribe: {},
    });
    const subscription = directory.subscription;
    if (!subscription) throw new Error("Paseo did not create an agent directory subscription");

    if (stopped) {
      await subscription.release();
      return;
    }

    directorySubscription = subscription;

    for (const entry of directory.entries) {
      attachAgent(entry.agent.id);
    }

    subscription.subscribe({
      snapshot({ entries }) {
        for (const entry of entries) attachAgent(entry.agent.id);
      },
      update(message) {
        if (message.type !== "agent_update") return;
        const update = message.payload;
        if (update.kind === "upsert") attachAgent(update.agent.id);
        if (update.kind === "remove") detachAgent(update.agentId);
      },
      error(error) {
        console.error("Paseo Ear agent directory listener failed:", error);
      },
    });
  };

  void start().catch((error: unknown) => {
    if (!stopped) console.error("Paseo Ear could not start its client listener:", error);
  });

  return () => {
    stopped = true;
    removeTestCommand();
    const directory = directorySubscription;
    directorySubscription = undefined;
    if (directory) {
      void directory.release().catch((error: unknown) => {
        console.error("Paseo Ear could not release the agent directory listener:", error);
      });
    }

    for (const agentId of timelineSubscriptions.keys()) detachAgent(agentId);
  };
}
