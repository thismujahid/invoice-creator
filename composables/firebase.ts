import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, type Auth } from "firebase/auth";
import {
  getFirestore,
  onSnapshot,
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  Timestamp,
  where,
  type Firestore,
  type Query,
  type CollectionReference,
  type DocumentReference,
} from "firebase/firestore";

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

function getFirebase() {
  if (app && auth && db) return { app, auth, db };
  const config = useRuntimeConfig().public;
  const firebaseConfig = {
    apiKey: (config.firebaseApiKey as string) || import.meta.env.NUXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBowUX9eYetQ3ttf9AR1aIjuOE4xVvWpt0",
    authDomain: (config.firebaseAuthDomain as string) || "invoices-creator-3da41.firebaseapp.com",
    projectId: (config.firebaseProjectId as string) || "invoices-creator-3da41",
    storageBucket: (config.firebaseStorageBucket as string) || "invoices-creator-3da41.firebasestorage.app",
    messagingSenderId: (config.firebaseMessagingSenderId as string) || "386510344101",
    appId: (config.firebaseAppId as string) || "1:386510344101:web:366393a055d573b0cee24c",
    measurementId: (config.firebaseMeasurementId as string) || "G-Y88NRM69K3",
  };
  app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  return { app, auth, db };
}

export type Filters = Record<string, string | number | boolean | Date | null | undefined>;

async function readFrom<T extends { id?: string }>(module: string, filters: Filters = {}): Promise<T[]> {
  try {
    const { db } = getFirebase();
    const colRef = collection(db, module);
    // FLAG [S2]: client-side query only — enforce Firestore Security Rules server-side.
    let q: Query | CollectionReference = colRef;

    for (const [key, value] of Object.entries(filters)) {
      if (key === "date" && value instanceof Date) {
        const startOfDay = new Date(value);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(value);
        endOfDay.setHours(23, 59, 59, 999);
        q = query(
          q,
          where("date", ">=", Timestamp.fromDate(startOfDay)),
          where("date", "<=", Timestamp.fromDate(endOfDay))
        );
      } else if (key === "created_by" && value) {
        q = query(q, where("created_by", "==", value));
      } else if (value !== undefined && value !== null && value !== "") {
        q = query(q, where(key, "==", value));
      }
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);
  } catch (error) {
    console.error("Error reading from Firestore:", error);
    return [];
  }
}

async function saveDataTo(module: string, data: Record<string, unknown>): Promise<DocumentReference | null> {
  try {
    const { db } = getFirebase();
    return await addDoc(collection(db, module), data);
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function updateItem(module: string, itemId: string, data: Record<string, unknown>): Promise<void | null> {
  try {
    const { db } = getFirebase();
    return await updateDoc(doc(db, module, itemId), data);
  } catch (e) {
    console.error(e);
    return null;
  }
}

// FLAG [B7-FIXED]: delete now has try/catch + typed return instead of unhandled rejection.
async function deleteItem(module: string, itemId: string): Promise<boolean> {
  try {
    const { db } = getFirebase();
    await deleteDoc(doc(db, module, itemId));
    return true;
  } catch (e) {
    console.error(`Error deleting ${module}/${itemId}:`, e);
    return false;
  }
}

// FLAG [B3-FIXED]: previously only fired on "modified" — now fires on added/modified/removed.
async function onDocChange(collectionName: string, callback: () => void | Promise<void>): Promise<() => void> {
  const { db } = getFirebase();
  const unsubscribe = onSnapshot(collection(db, collectionName), (snapshot) => {
    const hasChanges = snapshot.docChanges().some((c) => c.type === "added" || c.type === "modified" || c.type === "removed");
    if (hasChanges) void callback();
  });
  return unsubscribe;
}

export const useFirebase = () => {
  const { auth, db } = getFirebase();
  return {
    auth,
    db,
    onDocChange,
    signInWithEmailAndPassword,
    readFrom,
    saveDataTo,
    updateItem,
    deleteItem,
  };
};
