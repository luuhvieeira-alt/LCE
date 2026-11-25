import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { handleFirestoreError, OperationType } from './firestoreError';
import type {
  CharacterProfile,
  CreateCharacterInput,
  UpdateAppearanceInput,
  UpdateLocationInput,
} from '../types/character';

// Regex constants synchronized verbatim with firebase-blueprint.json and firestore.rules
const CHARACTER_NAME_REGEX = /^[a-zA-Z0-9À-ÿ _-]+$/;
const ALIAS_REGEX = /^[a-zA-Z0-9_-]+$/;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const INITIAL_CITIZEN_CASH = 500;
export const INITIAL_CITIZEN_BANK = 1000;
export const DEFAULT_SPAWN_X = 0;
export const DEFAULT_SPAWN_Z = 6.5;
export const DEFAULT_SPAWN_ROTY = Math.PI;

export function validateCharacterInput(input: CreateCharacterInput): string | null {
  const name = input.characterName.trim();
  const alias = input.alias.trim();

  if (name.length < 3 || name.length > 32) {
    return 'O nome do personagem deve ter entre 3 e 32 caracteres.';
  }
  if (!CHARACTER_NAME_REGEX.test(name)) {
    return 'O nome contém caracteres não permitidos.';
  }
  if (alias.length < 2 || alias.length > 24) {
    return 'O codinome deve ter entre 2 e 24 caracteres.';
  }
  if (!ALIAS_REGEX.test(alias)) {
    return 'O codinome aceita apenas letras sem acento, números, hífen e underline.';
  }
  if (
    !HEX_COLOR_REGEX.test(input.coatColor) ||
    !HEX_COLOR_REGEX.test(input.accentColor) ||
    !HEX_COLOR_REGEX.test(input.skinTone)
  ) {
    return 'Selecione cores válidas para o visual do personagem.';
  }
  return null;
}

export async function getCharacterProfile(uid: string): Promise<CharacterProfile | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    return snap.data() as CharacterProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeCharacterProfile(
  uid: string,
  onData: (profile: CharacterProfile | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as CharacterProfile) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function createCharacterProfile(
  uid: string,
  input: CreateCharacterInput
): Promise<void> {
  const validationError = validateCharacterInput(input);
  if (validationError) {
    throw new Error(validationError);
  }

  let initialCash = INITIAL_CITIZEN_CASH;
  let initialBank = INITIAL_CITIZEN_BANK;
  try {
    const cfgSnap = await getDoc(doc(db, 'economyConfig', 'global'));
    if (cfgSnap.exists()) {
      const cfg = cfgSnap.data() as { initialCleanCash?: number; initialBankBalance?: number };
      if (typeof cfg.initialCleanCash === 'number' && Number.isFinite(cfg.initialCleanCash)) {
        initialCash = cfg.initialCleanCash;
      }
      if (typeof cfg.initialBankBalance === 'number' && Number.isFinite(cfg.initialBankBalance)) {
        initialBank = cfg.initialBankBalance;
      }
    }
  } catch {
    // fallback to canonical initial balances
  }

  const path = `users/${uid}`;
  try {
    await setDoc(doc(db, 'users', uid), {
      uid,
      characterName: input.characterName.trim().slice(0, 32),
      alias: input.alias.trim().slice(0, 24),
      origin: input.origin,
      district: 'distrito-central',
      coatColor: input.coatColor,
      accentColor: input.accentColor,
      skinTone: input.skinTone,
      style: input.style,
      level: 1,
      experience: 0,
      reputation: 0,
      cashBalance: initialCash,
      bankBalance: initialBank,
      lastX: DEFAULT_SPAWN_X,
      lastZ: DEFAULT_SPAWN_Z,
      lastRotY: DEFAULT_SPAWN_ROTY,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateCharacterAppearance(
  uid: string,
  input: UpdateAppearanceInput
): Promise<void> {
  if (
    !HEX_COLOR_REGEX.test(input.coatColor) ||
    !HEX_COLOR_REGEX.test(input.accentColor) ||
    !HEX_COLOR_REGEX.test(input.skinTone)
  ) {
    throw new Error('Cores inválidas para atualização de visual.');
  }

  const path = `users/${uid}`;
  try {
    // Only cosmetic fields are sent — balances, level, experience, reputation and status are immutable in Firestore rules
    await updateDoc(doc(db, 'users', uid), {
      coatColor: input.coatColor,
      accentColor: input.accentColor,
      skinTone: input.skinTone,
      style: input.style,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateCharacterLocation(
  uid: string,
  input: UpdateLocationInput
): Promise<void> {
  const clampedX = Math.max(-36, Math.min(36, Math.round(input.lastX * 100) / 100));
  const clampedZ = Math.max(-36, Math.min(36, Math.round(input.lastZ * 100) / 100));
  const wrappedRot =
    (((input.lastRotY + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  const clampedRotY = Math.round(wrappedRot * 1000) / 1000;

  if (!Number.isFinite(clampedX) || !Number.isFinite(clampedZ) || !Number.isFinite(clampedRotY)) {
    return;
  }

  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      lastX: clampedX,
      lastZ: clampedZ,
      lastRotY: clampedRotY,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
