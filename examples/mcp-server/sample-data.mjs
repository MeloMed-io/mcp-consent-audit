// Fictional sample journal data for the demo. Nothing here is real.
// The arc runs anxious -> calm over a week so the mood timeline tells a story.

export const entries = [
  {
    id: "2026-06-18",
    date: "2026-06-18",
    mood: "anxious",
    valence: -0.5,
    arousal: 0.8,
    summary: "Couldn't sleep, spiraling about the launch deadline.",
    body: "Lay awake until 3am running worst-case scenarios about the launch. The raw, unfiltered version of this is exactly the kind of text a journaling app should not hand an AI by default.",
  },
  {
    id: "2026-06-19",
    date: "2026-06-19",
    mood: "frustrated",
    valence: -0.3,
    arousal: 0.6,
    summary: "Stuck on a bug for hours, snapped at a friend.",
    body: "Private entry: vented about the bug and about how I treated someone I care about. Sensitive. Elevated access only.",
  },
  {
    id: "2026-06-21",
    date: "2026-06-21",
    mood: "hopeful",
    valence: 0.2,
    arousal: 0.4,
    summary: "Went for a walk, things felt lighter.",
    body: "Private entry: a long, personal reflection on what's actually been weighing on me. Not for an agent to read unless I explicitly allow it.",
  },
  {
    id: "2026-06-23",
    date: "2026-06-23",
    mood: "calm",
    valence: 0.5,
    arousal: 0.2,
    summary: "Slept well, made real progress, felt steady.",
    body: "Private entry: gratitude list and some quiet thoughts. Raw text, gated behind journals:read:raw.",
  },
];

export const moodTimeline = entries.map((e) => ({
  date: e.date,
  mood: e.mood,
  valence: e.valence,
  arousal: e.arousal,
}));
