
import { initializeApp } from "firebase/app";
import {getAuth, GoogleAuthProvider} from "firebase/auth"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: "mockmate-ai-39cbe.firebaseapp.com",
  projectId: "mockmate-ai-39cbe",
  storageBucket: "mockmate-ai-39cbe.firebasestorage.app",
  messagingSenderId: "546782095834",
  appId: "1:546782095834:web:0bde391cc221b3869a78e3"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app)

const provider = new GoogleAuthProvider()

export {auth, provider}