import type { Timestamp } from 'firebase/firestore';

export type CharacterOrigin = 'comerciante' | 'operario' | 'corretor' | 'independente';
export type CharacterStyle = 'executivo' | 'urbano' | 'tatico';
export type CharacterStatus = 'active' | 'suspended';
export type DistrictId = 'distrito-central';

export interface CharacterProfile {
  uid: string;
  characterName: string;
  alias: string;
  origin: CharacterOrigin;
  district: DistrictId;
  coatColor: string;
  accentColor: string;
  skinTone: string;
  style: CharacterStyle;
  level: number;
  experience?: number;
  reputation: number;
  cashBalance: number;
  bankBalance: number;
  lastX?: number;
  lastZ?: number;
  lastRotY?: number;
  status: CharacterStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateCharacterInput {
  characterName: string;
  alias: string;
  origin: CharacterOrigin;
  coatColor: string;
  accentColor: string;
  skinTone: string;
  style: CharacterStyle;
}

export interface UpdateAppearanceInput {
  coatColor: string;
  accentColor: string;
  skinTone: string;
  style: CharacterStyle;
}

export interface UpdateLocationInput {
  lastX: number;
  lastZ: number;
  lastRotY: number;
}
