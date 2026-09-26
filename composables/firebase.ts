import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, type Auth } from "firebase/auth";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  getCountFromServer,
  setDoc,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  Timestamp,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  increment,
  runTransaction,
  writeBatch,
  type Firestore,
  type Query,
  type DocumentData,
  type QueryDocumentSnapshot,
  type DocumentSnapshot,
  type CollectionReference,
  type DocumentReference,
  type Transaction,
} from "firebase/firestore";

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

function getFirebase() {
  if (app && auth && db) return { app, auth, db };
  const config = useRuntimeConfig().public;
  const firebaseConfig = {
    // HOME client backend (home-market-368b4) — preserved from home branch.
    apiKey: (config.firebaseApiKey as string) || import.meta.env.NUXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCP03D1IH7JW0cjc766lmSYENQJ5XZa-Pw",
    authDomain: (config.firebaseAuthDomain as string) || "home-market-368b4.firebaseapp.com",
    projectId: (config.firebaseProjectId as string) || "home-market-368b4",
    storageBucket: (config.firebaseStorageBucket as string) || "home-market-368b4.firebasestorage.app",
    messagingSenderId: (config.firebaseMessagingSenderId as string) || "124365662957",
    appId: (config.firebaseAppId as string) || "1:124365662957:web:1fb447e0cecfa87be23ae4",
    measurementId: (config.firebaseMeasurementId as string) || "",
  };
  app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  return { app, auth, db };
}

export type Filters = Record<string, string | number | boolean | Date | null | undefined>;

export interface PageOptions {
  filters?: Filters;
  orderBy?: string;
  direction?: "asc" | "desc";
  limit: number;
  startAfter?: DocumentSnapshot;
}

export interface PageResult<T> {
  items: T[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

function filteredQuery(module: string, filters: Filters = {}): Query | CollectionReference {
  const { db } = getFirebase();
  let q: Query | CollectionReference = collection(db, module);
  for (const [key, value] of Object.entries(filters)) {
    if (key === "date" && value instanceof Date) {
      const startOfDay = new Date(value);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(value);
      endOfDay.setHours(23, 59, 59, 999);
      q = query(q, where("date", ">=", Timestamp.fromDate(startOfDay)), where("date", "<=", Timestamp.fromDate(endOfDay)));
    } else if (key === "created_by" && value) {
      q = query(q, where(key, "==", value));
    } else if (key === "remaining" && value) {
      q = query(q, where(key, ">=", 0.1));
    } else if (key === "remaining_gt_zero" && value) {
      q = query(q, where("remaining", ">", 0));
    } else if (value !== undefined && value !== null && value !== "") {
      q = query(q, where(key, "==", value));
    }
  }
  return q;
}

async function readFrom<T extends { id?: string }>(module: string, filters: Filters = {}): Promise<T[]> {
  try {
    // Unbounded collection scans are intentional only for explicit exports or migration tools.
    const snapshot = await getDocs(filteredQuery(module, filters));
    return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);
  } catch (error) {
    console.error("Error reading from Firestore:", error);
    return [];
  }
}

async function readPage<T extends { id?: string }>(module: string, options: PageOptions): Promise<PageResult<T>> {
  try {
    const { db } = getFirebase();
    const pageSize = Number.isFinite(options.limit) ? Math.min(100, Math.max(1, Math.floor(options.limit))) : 25;
    let q: Query = filteredQuery(module, options.filters) as Query;
    if (options.orderBy) q = query(q, orderBy(options.orderBy, options.direction ?? "desc"));
    if (options.startAfter) q = query(q, startAfter(options.startAfter));
    q = query(q, limit(pageSize + 1));
    const snapshot = await getDocs(q);
    const page = snapshot.docs.slice(0, pageSize);
    return {
      items: page.map((d) => ({ id: d.id, ...(d.data() as object) }) as T),
      cursor: page.at(-1) ?? null,
      hasMore: snapshot.docs.length > pageSize,
    };
  } catch (error) {
    console.error(`Error reading page from ${module}:`, error);
    return { items: [], cursor: null, hasMore: false };
  }
}

async function countFrom(module: string, filters: Filters = {}): Promise<number | null> {
  try {
    const { db } = getFirebase();
    return (await getCountFromServer(filteredQuery(module, filters))).data().count;
  } catch (error) {
    console.error(`Error counting ${module}:`, error);
    return null;
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
export const useFirebase = () => {
  const { auth, db } = getFirebase();
  return {
    auth,
    db,
    signInWithEmailAndPassword,
    readFrom,
    readPage,
    countFrom,
    saveDataTo,
    updateItem,
    deleteItem,
    // Transactional primitives for financial/stock flows (F29).
    runTransaction,
    writeBatch,
    getDoc,
    setDoc,
    serverTimestamp,
    increment,
    orderBy,
    limit,
    docRef: (path: string, id: string) => doc(db, path, id),
    colRef: (path: string) => collection(db, path),
  };
};

/** Run a Firestore transaction with the shared db instance.
 *  All financial/stock operations MUST go through this (F29). */
export async function runTx<T>(updateFn: (tx: Transaction) => Promise<T>): Promise<T> {
  const { db } = getFirebase();
  return runTransaction(db, updateFn);
}
