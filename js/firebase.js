import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import {
  getFirestore, collection, addDoc, getDocs, deleteDoc, doc, updateDoc,
  serverTimestamp, onSnapshot, query, orderBy, where, writeBatch
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import {
  getAuth, signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';

const ALLOWED_EMAILS = ['gabritupini@gmail.com', 'gabritupini3@gmail.com'];

let db, auth;
let syncStatusCallback = null;

export function initFirebase() {
  const app = initializeApp({
    apiKey: "AIzaSyCQo3IoYfNYx4FpU0mqURa-hCZn8CKWuQo",
    authDomain: "life-lessons-db.firebaseapp.com",
    projectId: "life-lessons-db",
    storageBucket: "life-lessons-db.firebasestorage.app",
    messagingSenderId: "103457012751",
    appId: "1:103457012751:web:00eef14c1066febe34f77a",
  });
  db = getFirestore(app);
  auth = getAuth(app);
}

export function onAuthReady(callback) {
  onAuthStateChanged(auth, (user) => {
    if (user && ALLOWED_EMAILS.includes(user.email)) {
      callback(user);
    } else if (user) {
      signOut(auth);
      callback(null);
    } else {
      callback(null);
    }
  });
}

export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    if (!ALLOWED_EMAILS.includes(result.user.email)) {
      await signOut(auth);
      return { error: 'unauthorized' };
    }
    return { user: result.user };
  } catch (err) {
    return { error: err.message };
  }
}

export async function logout() {
  await signOut(auth);
}

export function onSyncStatus(callback) {
  syncStatusCallback = callback;
}

function emitStatus(status) {
  if (syncStatusCallback) syncStatusCallback(status);
}

// ===== Pillars =====
export function subscribeToPillars(callback) {
  emitStatus('connecting');
  return onSnapshot(
    query(collection(db, 'pillars'), orderBy('order', 'asc')),
    (snap) => {
      emitStatus('synced');
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.error('subscribeToPillars error:', err);
      emitStatus('error');
    }
  );
}

export async function createPillar(data) {
  emitStatus('syncing');
  const ref = await addDoc(collection(db, 'pillars'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  emitStatus('synced');
  return ref.id;
}

export async function updatePillar(id, data) {
  emitStatus('syncing');
  await updateDoc(doc(db, 'pillars', id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  emitStatus('synced');
}

// Deletes a pillar AND all of its lessons.
export async function deletePillar(id) {
  emitStatus('syncing');
  const lessonsSnap = await getDocs(query(collection(db, 'lessons'), where('pillarId', '==', id)));
  const batch = writeBatch(db);
  lessonsSnap.docs.forEach(d => batch.delete(d.ref));
  batch.delete(doc(db, 'pillars', id));
  await batch.commit();
  emitStatus('synced');
}

// ===== Lessons =====
export function subscribeToLessons(callback) {
  emitStatus('connecting');
  return onSnapshot(
    collection(db, 'lessons'),
    (snap) => {
      emitStatus('synced');
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.error('subscribeToLessons error:', err);
      emitStatus('error');
    }
  );
}

export async function createLesson(data) {
  emitStatus('syncing');
  const ref = await addDoc(collection(db, 'lessons'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  emitStatus('synced');
  return ref.id;
}

export async function updateLesson(id, data) {
  emitStatus('syncing');
  await updateDoc(doc(db, 'lessons', id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  emitStatus('synced');
}

export async function deleteLesson(id) {
  emitStatus('syncing');
  await deleteDoc(doc(db, 'lessons', id));
  emitStatus('synced');
}

// ===== Study addendums =====
// Flat collection of addendums attached to studies (which are static HTML in
// /studies/). Each doc has { studyId, title, text, order } plus timestamps.
// The studyId is the catalog id from js/studies.js (e.g. 'pickup-soft-hard-limit').

export function subscribeToStudyNuances(callback) {
  emitStatus('connecting');
  return onSnapshot(
    query(collection(db, 'study_nuances'), orderBy('order', 'asc')),
    (snap) => {
      emitStatus('synced');
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.error('subscribeToStudyNuances error:', err);
      emitStatus('error');
    }
  );
}

export async function createStudyNuance(data) {
  emitStatus('syncing');
  const ref = await addDoc(collection(db, 'study_nuances'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  emitStatus('synced');
  return ref.id;
}

export async function updateStudyNuance(id, data) {
  emitStatus('syncing');
  await updateDoc(doc(db, 'study_nuances', id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  emitStatus('synced');
}

export async function deleteStudyNuance(id) {
  emitStatus('syncing');
  await deleteDoc(doc(db, 'study_nuances', id));
  emitStatus('synced');
}

// ===== Bulk operations =====
export async function seedDefaultPillars(defaults) {
  emitStatus('syncing');
  const batch = writeBatch(db);
  defaults.forEach(p => {
    const ref = doc(collection(db, 'pillars'));
    batch.set(ref, {
      ...p,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
  emitStatus('synced');
}

export async function exportAll() {
  const [pillarsSnap, lessonsSnap, studyNuancesSnap] = await Promise.all([
    getDocs(collection(db, 'pillars')),
    getDocs(collection(db, 'lessons')),
    getDocs(collection(db, 'study_nuances')),
  ]);
  const strip = (data) => {
    const out = { ...data };
    delete out.createdAt;
    delete out.updatedAt;
    return out;
  };
  return {
    exportedAt: new Date().toISOString(),
    pillars: pillarsSnap.docs.map(d => ({ id: d.id, ...strip(d.data()) })),
    lessons: lessonsSnap.docs.map(d => ({ id: d.id, ...strip(d.data()) })),
    studyNuances: studyNuancesSnap.docs.map(d => ({ id: d.id, ...strip(d.data()) })),
  };
}

// Replace-all import: wipes existing pillars + lessons + study_nuances,
// then writes the payload. Preserves original ids when possible.
export async function importAll(payload) {
  emitStatus('syncing');
  const [pillarsSnap, lessonsSnap, studyNuancesSnap] = await Promise.all([
    getDocs(collection(db, 'pillars')),
    getDocs(collection(db, 'lessons')),
    getDocs(collection(db, 'study_nuances')),
  ]);

  // Wipe in chunks (batch max 500)
  const wipeBatches = [];
  let batch = writeBatch(db);
  let count = 0;
  const enqueueDelete = (ref) => {
    batch.delete(ref);
    count++;
    if (count >= 400) {
      wipeBatches.push(batch.commit());
      batch = writeBatch(db);
      count = 0;
    }
  };
  pillarsSnap.docs.forEach(d => enqueueDelete(d.ref));
  lessonsSnap.docs.forEach(d => enqueueDelete(d.ref));
  studyNuancesSnap.docs.forEach(d => enqueueDelete(d.ref));
  if (count > 0) wipeBatches.push(batch.commit());
  await Promise.all(wipeBatches);

  // Write payload
  const writeBatches = [];
  batch = writeBatch(db);
  count = 0;
  const enqueueWrite = (ref, data) => {
    batch.set(ref, {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    count++;
    if (count >= 400) {
      writeBatches.push(batch.commit());
      batch = writeBatch(db);
      count = 0;
    }
  };
  (payload.pillars || []).forEach(p => {
    const { id, ...rest } = p;
    const ref = id ? doc(db, 'pillars', id) : doc(collection(db, 'pillars'));
    enqueueWrite(ref, rest);
  });
  (payload.lessons || []).forEach(l => {
    const { id, ...rest } = l;
    const ref = id ? doc(db, 'lessons', id) : doc(collection(db, 'lessons'));
    enqueueWrite(ref, rest);
  });
  (payload.studyNuances || []).forEach(n => {
    const { id, ...rest } = n;
    const ref = id ? doc(db, 'study_nuances', id) : doc(collection(db, 'study_nuances'));
    enqueueWrite(ref, rest);
  });
  if (count > 0) writeBatches.push(batch.commit());
  await Promise.all(writeBatches);

  emitStatus('synced');
  return {
    pillars: (payload.pillars || []).length,
    lessons: (payload.lessons || []).length,
    studyNuances: (payload.studyNuances || []).length,
  };
}
