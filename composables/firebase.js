import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, onSnapshot } from "firebase/firestore";
import { collection, getDocs, doc, updateDoc, deleteDoc, addDoc, query, Timestamp, where } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBowUX9eYetQ3ttf9AR1aIjuOE4xVvWpt0",
    authDomain: "invoices-creator-3da41.firebaseapp.com",
    projectId: "invoices-creator-3da41",
    storageBucket: "invoices-creator-3da41.firebasestorage.app",
    messagingSenderId: "386510344101",
    appId: "1:386510344101:web:366393a055d573b0cee24c",
    measurementId: "G-Y88NRM69K3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
async function readFrom(module, filters = {}) {
    try {
        const productsCollection = collection(db, module);
        let q = productsCollection;
        Object.entries(filters).forEach(([key, value]) => {
            if (key === "created_at" && value) {
                const timestamp = Timestamp.fromDate(new Date(value));
                q = query(q, where(key, "==", timestamp));
            } else if (value) {
                q = query(q,
                    where(key, ">=", value),
                    where(key, "<=", value + '\uf8ff'));
            }
        });
        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => {
            return ({ id: doc.id, ...doc.data() })
        });
    } catch (e) {
        console.error(e);
        return [];
    }
}
async function saveDataTo(module, data) {
    try {
        const productsCollection = collection(db, module);
        return await addDoc(productsCollection, data);
    } catch (e) {
        console.error(e);
        return null
    }
}
async function updateItem(module, itemId, data) {
    try {
        const productDoc = doc(db, module, itemId);
        return await updateDoc(productDoc, data);
    } catch (e) {
        console.log(e);
        return null
    }
}
async function deleteItem(module, itemId) {
    try {
        const productDoc = doc(db, module, itemId);
        return await deleteDoc(productDoc);
    } catch (e) {
        console.error(e);
        return null
    }
}
async function onDocChange(collectionName, callback) {
    const collectionRef = collection(db, collectionName);
    const unsubscribe = onSnapshot(collectionRef, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'modified') {
                callback(snapshot.docs)
            }
        })
    });
    return unsubscribe;
}
export const useFirebase = () => ({ auth, db, onDocChange, signInWithEmailAndPassword, readFrom, saveDataTo, updateItem, deleteItem });
