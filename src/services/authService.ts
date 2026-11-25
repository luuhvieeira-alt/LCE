import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '../config/firebase';
import { handleFirestoreError, OperationType } from './firestoreError';
import type { AuthProviderType, ServerAuthVerification } from '../types/user';

function formatAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code)
      : '';

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Janela de autenticação fechada antes da conclusão.';
    case 'auth/popup-blocked':
      return 'O navegador bloqueou a janela de login. Permita pop-ups para continuar.';
    case 'auth/operation-not-allowed':
      return 'Login por E-mail/Senha ainda não foi habilitado no Firebase Console. Utilize "Entrar com Google" (já ativo) ou habilite E-mail/Senha em Authentication > Sign-in method.';
    case 'auth/email-already-in-use':
      return 'Este e-mail já está cadastrado. Faça login na aba Entrar.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'E-mail ou senha inválidos.';
    case 'auth/weak-password':
      return 'A senha deve possuir no mínimo 6 caracteres.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas recentes. Aguarde alguns instantes e tente novamente.';
    default:
      return error instanceof Error ? error.message : 'Não foi possível concluir a autenticação.';
  }
}

export async function loginWithGoogle(): Promise<User> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    throw new Error(formatAuthError(error));
  }
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const result = await signInWithEmailAndPassword(auth, cleanEmail, password);
    return result.user;
  } catch (error) {
    throw new Error(formatAuthError(error));
  }
}

export async function registerWithEmail(email: string, password: string): Promise<User> {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const result = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    await sendEmailVerification(result.user);
    return result.user;
  } catch (error) {
    throw new Error(formatAuthError(error));
  }
}

export async function resendVerificationEmail(user: User): Promise<void> {
  try {
    await sendEmailVerification(user);
  } catch (error) {
    throw new Error(formatAuthError(error));
  }
}

export async function logoutSession(): Promise<void> {
  await signOut(auth);
}

export async function syncPrivateAccount(user: User): Promise<void> {
  // Firestore rules strictly require verified email for writes
  if (!user.emailVerified || !user.email) {
    return;
  }

  const path = `users/${user.uid}/private/account`;
  const ref = doc(db, 'users', user.uid, 'private', 'account');
  const provider: AuthProviderType = user.providerData.some((p) => p.providerId === 'google.com')
    ? 'google'
    : 'password';
  const safeEmail = user.email.trim().slice(0, 160);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: safeEmail,
        provider,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        email: safeEmail,
        provider,
        lastLoginAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function verifyTokenWithServer(user: User): Promise<ServerAuthVerification | null> {
  try {
    const token = await user.getIdToken();
    const response = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as ServerAuthVerification;
  } catch {
    return null;
  }
}
