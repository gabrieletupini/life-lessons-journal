// One-time seeded addendums. On first app load (per browser), any seed not
// yet present in Firestore is fetched and created. After import the seedId is
// remembered in localStorage so it doesn't get auto-re-created if the user
// deletes it.

export const SEED_ADDENDUMS = [
  {
    seedId: 'soft-hard-babystepping-v1',
    studyId: 'pickup-soft-hard-limit',
    title: 'Move Very Small, With a Time Constraint',
    description:
      'When she\'s well inside the flow but pushing the soft limit, every ask is priced in time — make the next ask cost near zero.',
    file: 'studies/pickup/addendums/babystepping-nuance.html',
    order: 0,
  },
];
