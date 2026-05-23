// Static catalog of long-form studies/articles. They live as standalone HTML
// files under /studies/<pillar-slug>/<name>.html so they can be opened in a
// new tab AND downloaded as self-contained documents.
//
// `pillarName` matches the pillar's `name` field exactly. That avoids having
// to know the Firestore-generated pillar id, and means renaming a pillar in
// the DB won't break the catalog (you update the name here too).
//
// A lesson can reference one or more studies via a `studyIds` array on the
// lesson document (handled in app.js).

export const STUDIES = [
  {
    id: 'pickup-patience-acceptance-push',
    pillarName: 'Pickup',
    title: 'Patience, Acceptance, Push',
    excerpt:
      'On the two desire curves (spontaneous vs responsive), why frustration never moves the curve, and the three-word frame that does.',
    readingMinutes: 7,
    file: 'studies/pickup/patience-acceptance-push.html',
    publishedAt: '2026-05-23',
  },
  {
    id: 'pickup-soft-hard-limit',
    pillarName: 'Pickup',
    title: 'Soft limit, hard limit',
    excerpt:
      'Every date has two clocks — the stated soft limit and the real hard one. How to read both, design the evening around the right one, and never confuse them.',
    readingMinutes: 8,
    file: 'studies/pickup/soft-hard-limit.html',
    publishedAt: '2026-05-23',
  },
];
