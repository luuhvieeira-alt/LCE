import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../config/firebase';
import type { GameModuleId } from '../config/gameModules';
import type { CharacterProfile, UpdateAppearanceInput } from '../types/character';
import type { AdminSessionStatus } from '../types/user';
import type { EconomyBaseConfig } from '../types/admin';
import type {
  BankAccount,
  BankDirectoryEntry,
  FinancialTransaction,
  JobDefinition,
  JobExperience,
  SalaryPayment,
  Wallet,
  WorkSession,
} from '../types/economy';
import type {
  ConnectionState,
  PlayerPositionPayload,
  RemotePlayerState,
  SharedVehicleState,
  VehicleCorrectionPayload,
  VehicleMotionPayload,
} from '../types/multiplayer';
import type {
  BusinessApplication,
  BusinessEmployee,
  BusinessLocation,
  BusinessRecord,
  BusinessVacancy,
} from '../types/business';
import type {
  DealershipStockItem,
  PlayerVehicle,
  VehicleCatalogModel,
  VehicleListing,
} from '../types/vehicle';
import { DEFAULT_JOBS_CATALOG } from '../config/economyCatalog';
import { DEFAULT_BUSINESS_LOCATIONS } from '../config/businessCatalog';
import { DEFAULT_VEHICLE_CATALOG } from '../config/vehicleCatalog';
import { logoutSession, syncPrivateAccount } from '../services/authService';
import {
  DEFAULT_SPAWN_ROTY,
  DEFAULT_SPAWN_X,
  DEFAULT_SPAWN_Z,
  subscribeCharacterProfile,
  updateCharacterAppearance,
  updateCharacterLocation,
} from '../services/characterService';
import { getEconomyConfig, resolveAdminStatus } from '../services/adminService';
import {
  bootstrapEconomy,
  subscribeBankAccount,
  subscribeBankDirectory,
  subscribeJobExperience,
  subscribeJobsCatalog,
  subscribePlayerTransactions,
  subscribePlayerWorkSessions,
  subscribeSalaryPayments,
  subscribeWallet,
} from '../services/economyService';
import {
  subscribeBusinesses,
  subscribeBusinessLocations,
  subscribeMyBusinessApplications,
  subscribeMyEmploymentContracts,
  subscribeOpenVacancies,
} from '../services/businessService';
import {
  bootstrapInitialVehicleStock,
  spawnVehicleToWorld,
  storeVehicleInGarage,
  subscribeActiveVehicleListings,
  subscribeAvailableDealershipStock,
  subscribeMyVehicles,
  subscribeVehicleCatalog,
} from '../services/vehicleService';
import { SharedWorldClient } from '../services/multiplayerService';

export type AppStage = 'splash' | 'auth' | 'creator' | 'game';
export type GraphicsPreset = 'alta' | 'equilibrada';
export type CameraPreset = 'terceira-pessoa' | 'orbital';

interface GameContextValue {
  stage: AppStage;
  enterFromSplash: () => void;
  firebaseUser: User | null;
  authReady: boolean;
  character: CharacterProfile | null;
  characterLoading: boolean;
  adminStatus: AdminSessionStatus;
  economyConfig: EconomyBaseConfig | null;
  wallet: Wallet | null;
  bankAccount: BankAccount | null;
  jobExperience: JobExperience | null;
  jobsCatalog: JobDefinition[];
  workSessions: WorkSession[];
  activeWorkSession: WorkSession | null;
  transactions: FinancialTransaction[];
  salaryPayments: SalaryPayment[];
  bankDirectory: BankDirectoryEntry[];
  economyReady: boolean;
  economyError: string | null;
  businessLocations: BusinessLocation[];
  businesses: BusinessRecord[];
  openVacancies: BusinessVacancy[];
  myEmployeeContracts: BusinessEmployee[];
  myBusinessApplications: BusinessApplication[];
  selectedBusinessId: string | null;
  setSelectedBusinessId: (id: string | null) => void;
  preferredBusinessTab: string | null;
  setPreferredBusinessTab: (tab: string | null) => void;
  enterBusinessById: (businessOrLocationId: string) => void;
  enterDealershipShowroom: (businessId: string) => void;
  vehicleCatalog: VehicleCatalogModel[];
  myVehicles: PlayerVehicle[];
  availableDealershipStock: DealershipStockItem[];
  activeVehicleListings: VehicleListing[];
  activeModule: GameModuleId;
  setActiveModule: (mod: GameModuleId) => void;
  remotePlayers: Record<string, RemotePlayerState>;
  worldVehicles: Record<string, SharedVehicleState>;
  drivingVehicleId: string | null;
  mySpawnedVehicle: SharedVehicleState | null;
  activeDrivenVehicle: SharedVehicleState | null;
  pendingPlayerTeleport: { x: number; z: number; seq: number } | null;
  vehicleCorrection: (VehicleCorrectionPayload & { seq: number }) | null;
  vehicleNotice: { type: 'ok' | 'err'; text: string } | null;
  clearVehicleNotice: () => void;
  spawnVehicle: (vehicleId: string) => Promise<SharedVehicleState>;
  storeVehicle: (vehicleId: string) => Promise<void>;
  enterVehicle: (vehicleId: string) => void;
  exitVehicle: (vehicleId?: string) => void;
  reportLocalVehicleMotion: (payload: VehicleMotionPayload) => void;
  onlineCount: number;
  mpConnection: ConnectionState;
  playerCoords: { x: number; z: number };
  reportLocalPosition: (pos: PlayerPositionPayload) => void;
  saveAppearance: (input: UpdateAppearanceInput) => Promise<void>;
  refreshEconomyConfig: () => Promise<void>;
  refreshAdminStatus: () => Promise<void>;
  graphicsPreset: GraphicsPreset;
  setGraphicsPreset: (preset: GraphicsPreset) => void;
  cameraPreset: CameraPreset;
  setCameraPreset: (preset: CameraPreset) => void;
  signOutUser: () => Promise<void>;
}

const DEFAULT_ADMIN_STATUS: AdminSessionStatus = {
  isAdmin: false,
  role: null,
  label: null,
  isBootstrappedOwner: false,
  verifiedByServer: false,
};

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [splashDismissed, setSplashDismissed] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [character, setCharacter] = useState<CharacterProfile | null>(null);
  const [characterLoading, setCharacterLoading] = useState(false);
  const [adminStatus, setAdminStatus] = useState<AdminSessionStatus>(DEFAULT_ADMIN_STATUS);
  const [economyConfig, setEconomyConfig] = useState<EconomyBaseConfig | null>(null);

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [bankAccount, setBankAccount] = useState<BankAccount | null>(null);
  const [jobExperience, setJobExperience] = useState<JobExperience | null>(null);
  const [jobsCatalog, setJobsCatalog] = useState<JobDefinition[]>(DEFAULT_JOBS_CATALOG);
  const [workSessions, setWorkSessions] = useState<WorkSession[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [salaryPayments, setSalaryPayments] = useState<SalaryPayment[]>([]);
  const [bankDirectory, setBankDirectory] = useState<BankDirectoryEntry[]>([]);
  const [economyReady, setEconomyReady] = useState(false);
  const [economyError, setEconomyError] = useState<string | null>(null);
  const [businessLocations, setBusinessLocations] = useState<BusinessLocation[]>(
    DEFAULT_BUSINESS_LOCATIONS
  );
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [openVacancies, setOpenVacancies] = useState<BusinessVacancy[]>([]);
  const [myEmployeeContracts, setMyEmployeeContracts] = useState<BusinessEmployee[]>([]);
  const [myBusinessApplications, setMyBusinessApplications] = useState<BusinessApplication[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);
  const [preferredBusinessTab, setPreferredBusinessTab] = useState<string | null>(null);
  const [vehicleCatalog, setVehicleCatalog] = useState<VehicleCatalogModel[]>(
    DEFAULT_VEHICLE_CATALOG
  );
  const [myVehicles, setMyVehicles] = useState<PlayerVehicle[]>([]);
  const [availableDealershipStock, setAvailableDealershipStock] = useState<
    DealershipStockItem[]
  >([]);
  const [activeVehicleListings, setActiveVehicleListings] = useState<VehicleListing[]>([]);

  const [activeModule, setActiveModuleState] = useState<GameModuleId>('mundo');
  const [remotePlayers, setRemotePlayers] = useState<Record<string, RemotePlayerState>>({});
  const [worldVehicles, setWorldVehicles] = useState<Record<string, SharedVehicleState>>({});
  const [drivingVehicleId, setDrivingVehicleId] = useState<string | null>(null);
  const [pendingPlayerTeleport, setPendingPlayerTeleport] = useState<{
    x: number;
    z: number;
    seq: number;
  } | null>(null);
  const [vehicleCorrection, setVehicleCorrection] = useState<
    (VehicleCorrectionPayload & { seq: number }) | null
  >(null);
  const [vehicleNotice, setVehicleNotice] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [mpConnection, setMpConnection] = useState<ConnectionState>('disconnected');
  const [playerCoords, setPlayerCoords] = useState<{ x: number; z: number }>({
    x: DEFAULT_SPAWN_X,
    z: DEFAULT_SPAWN_Z,
  });

  const [graphicsPreset, setGraphicsPreset] = useState<GraphicsPreset>('equilibrada');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('terceira-pessoa');

  const mpClientRef = useRef<SharedWorldClient | null>(null);
  const coordsUpdateRef = useRef<number>(0);
  const latestPosRef = useRef<{ x: number; z: number; rotY: number }>({
    x: DEFAULT_SPAWN_X,
    z: DEFAULT_SPAWN_Z,
    rotY: DEFAULT_SPAWN_ROTY,
  });
  const lastSavedPosRef = useRef<{ x: number; z: number; ts: number }>({
    x: DEFAULT_SPAWN_X,
    z: DEFAULT_SPAWN_Z,
    ts: 0,
  });
  const firebaseUserRef = useRef<User | null>(null);
  const characterRef = useRef<CharacterProfile | null>(null);
  const worldVehiclesRef = useRef<Record<string, SharedVehicleState>>({});
  const drivingVehicleIdRef = useRef<string | null>(null);

  useEffect(() => {
    worldVehiclesRef.current = worldVehicles;
  }, [worldVehicles]);

  useEffect(() => {
    drivingVehicleIdRef.current = drivingVehicleId;
  }, [drivingVehicleId]);

  useEffect(() => {
    firebaseUserRef.current = firebaseUser;
  }, [firebaseUser]);

  useEffect(() => {
    characterRef.current = character;
  }, [character]);

  // 1. Observe Firebase Authentication state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (!user) {
        setCharacter(null);
        setCharacterLoading(false);
        setAdminStatus(DEFAULT_ADMIN_STATUS);
        setEconomyConfig(null);
        setWallet(null);
        setBankAccount(null);
        setJobExperience(null);
        setWorkSessions([]);
        setTransactions([]);
        setSalaryPayments([]);
        setBankDirectory([]);
        setEconomyReady(false);
        setEconomyError(null);
        setBusinesses([]);
        setOpenVacancies([]);
        setMyEmployeeContracts([]);
        setMyBusinessApplications([]);
        setSelectedBusinessId(null);
        setPreferredBusinessTab(null);
        setMyVehicles([]);
        setAvailableDealershipStock([]);
        setActiveVehicleListings([]);
        setRemotePlayers({});
        setWorldVehicles({});
        setDrivingVehicleId(null);
        setVehicleNotice(null);
        setMpConnection('disconnected');
        setActiveModuleState('mundo');
      }
    });
    return () => unsub();
  }, []);

  // 2. Sync private account, subscribe to CharacterProfile, resolve real Admin RBAC, load economyConfig
  const refreshEconomyConfig = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const cfg = await getEconomyConfig();
      setEconomyConfig(cfg);
    } catch {
      setEconomyConfig(null);
    }
  }, [firebaseUser]);

  const refreshAdminStatus = useCallback(async () => {
    if (!firebaseUser) {
      setAdminStatus(DEFAULT_ADMIN_STATUS);
      return;
    }
    const status = await resolveAdminStatus(firebaseUser);
    setAdminStatus(status);
  }, [firebaseUser]);

  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    setCharacterLoading(true);
    void syncPrivateAccount(firebaseUser);
    void refreshAdminStatus();
    void refreshEconomyConfig();

    const unsub = subscribeCharacterProfile(
      firebaseUser.uid,
      (profile) => {
        setCharacter(profile);
        setCharacterLoading(false);
        if (profile && !characterRef.current) {
          const initX = typeof profile.lastX === 'number' ? profile.lastX : DEFAULT_SPAWN_X;
          const initZ = typeof profile.lastZ === 'number' ? profile.lastZ : DEFAULT_SPAWN_Z;
          const initRotY =
            typeof profile.lastRotY === 'number' ? profile.lastRotY : DEFAULT_SPAWN_ROTY;
          latestPosRef.current = { x: initX, z: initZ, rotY: initRotY };
          lastSavedPosRef.current = { x: initX, z: initZ, ts: Date.now() };
          setPlayerCoords({
            x: Math.round(initX * 10) / 10,
            z: Math.round(initZ * 10) / 10,
          });
        }
      },
      () => {
        setCharacterLoading(false);
      }
    );

    return () => unsub();
  }, [authReady, firebaseUser, refreshAdminStatus, refreshEconomyConfig]);

  // 2b. Bootstrap citizen wallet, bank account, directory & job XP via Node.js server and attach live Firestore listeners
  useEffect(() => {
    if (!firebaseUser || !character || !firebaseUser.emailVerified) {
      setWallet(null);
      setBankAccount(null);
      setJobExperience(null);
      setWorkSessions([]);
      setTransactions([]);
      setSalaryPayments([]);
      setBankDirectory([]);
      setEconomyReady(false);
      return;
    }

    let cancelled = false;
    setEconomyError(null);

    void bootstrapEconomy(firebaseUser)
      .then(() => {
        if (!cancelled) setEconomyReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setEconomyReady(true);
          setEconomyError(
            err instanceof Error ? err.message : 'Falha ao sincronizar sistema econômico.'
          );
        }
      });

    // Ensure official initial dealership stock exists persistently (idempotent, non-destructive)
    void bootstrapInitialVehicleStock(firebaseUser).catch(() => {
      // Non-fatal background stock bootstrap
    });

    const unsubWallet = subscribeWallet(firebaseUser.uid, setWallet);
    const unsubBank = subscribeBankAccount(firebaseUser.uid, setBankAccount);
    const unsubXp = subscribeJobExperience(firebaseUser.uid, setJobExperience);
    const unsubTx = subscribePlayerTransactions(firebaseUser.uid, setTransactions);
    const unsubDir = subscribeBankDirectory(setBankDirectory);
    const unsubJobs = subscribeJobsCatalog(setJobsCatalog);
    const unsubSessions = subscribePlayerWorkSessions(firebaseUser.uid, setWorkSessions);
    const unsubSalaries = subscribeSalaryPayments(firebaseUser.uid, setSalaryPayments);
    const unsubLocations = subscribeBusinessLocations(setBusinessLocations);
    const unsubBusinesses = subscribeBusinesses(setBusinesses);
    const unsubVacancies = subscribeOpenVacancies(setOpenVacancies);
    const unsubContracts = subscribeMyEmploymentContracts(
      firebaseUser.uid,
      setMyEmployeeContracts
    );
    const unsubApps = subscribeMyBusinessApplications(
      firebaseUser.uid,
      setMyBusinessApplications
    );
    const unsubVehicleCatalog = subscribeVehicleCatalog(setVehicleCatalog);
    const unsubMyVehicles = subscribeMyVehicles(firebaseUser.uid, setMyVehicles);
    const unsubDealershipStock = subscribeAvailableDealershipStock(setAvailableDealershipStock);
    const unsubVehicleListings = subscribeActiveVehicleListings(setActiveVehicleListings);

    return () => {
      cancelled = true;
      unsubWallet();
      unsubBank();
      unsubXp();
      unsubTx();
      unsubDir();
      unsubJobs();
      unsubSessions();
      unsubSalaries();
      unsubLocations();
      unsubBusinesses();
      unsubVacancies();
      unsubContracts();
      unsubApps();
      unsubVehicleCatalog();
      unsubMyVehicles();
      unsubDealershipStock();
      unsubVehicleListings();
    };
  }, [firebaseUser, character?.uid]);

  // 3. Connect authoritative WebSocket multiplayer when authenticated & character ready
  useEffect(() => {
    if (!firebaseUser || !character || !firebaseUser.emailVerified) {
      mpClientRef.current?.disconnect();
      mpClientRef.current = null;
      setRemotePlayers({});
      return;
    }

    if (mpClientRef.current) {
      mpClientRef.current.updateCharacterMeta(character);
      return;
    }

    const client = new SharedWorldClient(
      character,
      async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
      {
        onConnectionChange: (state) => {
          setMpConnection(state);
          // Clear stale remote avatars & vehicles whenever connection drops so closed sessions never linger
          if (state === 'disconnected' || state === 'reconnecting') {
            setRemotePlayers({});
            setWorldVehicles({});
            setDrivingVehicleId(null);
          }
        },
        onSnapshot: (players, vehicles, selfUid) => {
          const nextPlayers: Record<string, RemotePlayerState> = {};
          for (const p of players) {
            if (p.uid !== selfUid) {
              nextPlayers[p.uid] = p;
            }
          }
          setRemotePlayers(nextPlayers);

          const nextVehicles: Record<string, SharedVehicleState> = {};
          let selfDriven: string | null = null;
          for (const v of vehicles) {
            nextVehicles[v.vehicleId] = v;
            if (v.driverUid === selfUid) {
              selfDriven = v.vehicleId;
            }
          }
          setWorldVehicles(nextVehicles);
          setDrivingVehicleId(selfDriven);
        },
        onPlayerJoined: (player) => {
          if (player.uid === firebaseUser.uid) return;
          setRemotePlayers((prev) => ({
            ...prev,
            [player.uid]: player,
          }));
        },
        onPlayerUpdated: (player) => {
          if (player.uid === firebaseUser.uid) return;
          setRemotePlayers((prev) => ({
            ...prev,
            [player.uid]: player,
          }));
        },
        onPlayerMoved: (uid, x, z, rotY, isMoving) => {
          if (uid === firebaseUser.uid) return;
          setRemotePlayers((prev) => {
            const existing = prev[uid];
            if (!existing) return prev;
            return {
              ...prev,
              [uid]: {
                ...existing,
                x,
                z,
                rotY,
                isMoving,
                updatedAt: Date.now(),
              },
            };
          });
        },
        onPlayerLeft: (uid) => {
          setRemotePlayers((prev) => {
            if (!prev[uid]) return prev;
            const copy = { ...prev };
            delete copy[uid];
            return copy;
          });
        },
        onVehicleSpawned: (vehicle) => {
          setWorldVehicles((prev) => ({
            ...prev,
            [vehicle.vehicleId]: vehicle,
          }));
        },
        onVehicleEntered: (vehicle, driverUid) => {
          setWorldVehicles((prev) => ({
            ...prev,
            [vehicle.vehicleId]: vehicle,
          }));
          if (driverUid === firebaseUser.uid) {
            setDrivingVehicleId(vehicle.vehicleId);
          } else {
            setRemotePlayers((prev) => {
              const rp = prev[driverUid];
              if (!rp) return prev;
              return {
                ...prev,
                [driverUid]: {
                  ...rp,
                  drivingVehicleId: vehicle.vehicleId,
                  isMoving: false,
                },
              };
            });
          }
        },
        onVehicleUpdated: (patch) => {
          setWorldVehicles((prev) => {
            const existing = prev[patch.vehicleId];
            if (!existing) return prev;
            return {
              ...prev,
              [patch.vehicleId]: {
                ...existing,
                x: patch.x,
                z: patch.z,
                rotY: patch.rotY,
                speed: patch.speed,
                steerAngle: patch.steerAngle,
                throttle: patch.throttle,
                braking: patch.braking,
                handbrake: patch.handbrake,
                boost: patch.boost,
                state: patch.state,
                fuelLevel: patch.fuelLevel,
                condition: patch.condition,
                sessionDistanceM: patch.sessionDistanceM,
                driverUid: patch.driverUid,
                driverName: patch.driverName,
                updatedAt: patch.updatedAt,
              },
            };
          });
        },
        onVehicleExited: (vehicle, uid, exitX, exitZ) => {
          setWorldVehicles((prev) => ({
            ...prev,
            [vehicle.vehicleId]: vehicle,
          }));
          if (uid === firebaseUser.uid) {
            setDrivingVehicleId(null);
            latestPosRef.current = { ...latestPosRef.current, x: exitX, z: exitZ };
            setPendingPlayerTeleport({ x: exitX, z: exitZ, seq: Date.now() });
          } else {
            setRemotePlayers((prev) => {
              const rp = prev[uid];
              if (!rp) return prev;
              return {
                ...prev,
                [uid]: {
                  ...rp,
                  x: exitX,
                  z: exitZ,
                  drivingVehicleId: null,
                  isMoving: false,
                  updatedAt: Date.now(),
                },
              };
            });
          }
        },
        onVehicleDespawned: (vehicleId) => {
          setWorldVehicles((prev) => {
            if (!prev[vehicleId]) return prev;
            const copy = { ...prev };
            delete copy[vehicleId];
            return copy;
          });
          setDrivingVehicleId((cur) => (cur === vehicleId ? null : cur));
        },
        onVehicleCorrection: (correction) => {
          setVehicleCorrection({ ...correction, seq: Date.now() });
        },
        onVehicleError: (message) => {
          setVehicleNotice({ type: 'err', text: message });
        },
      }
    );

    mpClientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      mpClientRef.current = null;
      setRemotePlayers({});
      setWorldVehicles({});
      setDrivingVehicleId(null);
    };
  }, [firebaseUser, character?.uid]);

  // Guard admin route selection
  const setActiveModule = useCallback(
    (mod: GameModuleId) => {
      if (mod === 'admin' && !adminStatus.isAdmin) {
        return;
      }
      setActiveModuleState(mod);
    },
    [adminStatus.isAdmin]
  );

  const enterBusinessById = useCallback((businessOrLocationId: string) => {
    setPreferredBusinessTab(null);
    setSelectedBusinessId(businessOrLocationId);
    setActiveModuleState('empresas');
  }, []);

  const enterDealershipShowroom = useCallback((businessId: string) => {
    setSelectedBusinessId(businessId);
    setPreferredBusinessTab('showroom');
    setActiveModuleState('empresas');
  }, []);

  // Report position to multiplayer server + HUD + periodic Firestore location persistence
  const reportLocalPosition = useCallback((pos: PlayerPositionPayload) => {
    latestPosRef.current = { x: pos.x, z: pos.z, rotY: pos.rotY };
    mpClientRef.current?.sendPosition(pos);

    const now = performance.now();
    if (now - coordsUpdateRef.current > 200) {
      coordsUpdateRef.current = now;
      setPlayerCoords({
        x: Math.round(pos.x * 10) / 10,
        z: Math.round(pos.z * 10) / 10,
      });
    }

    // Persist character location to Firestore only when moved >= 1.5m and >= 12s elapsed (Spark-friendly)
    const user = firebaseUserRef.current;
    const char = characterRef.current;
    if (user && user.emailVerified && char && char.status === 'active') {
      const dist = Math.hypot(
        pos.x - lastSavedPosRef.current.x,
        pos.z - lastSavedPosRef.current.z
      );
      const elapsed = Date.now() - lastSavedPosRef.current.ts;
      if (dist >= 1.5 && (!pos.isMoving ? elapsed >= 5000 : elapsed >= 14000)) {
        lastSavedPosRef.current = { x: pos.x, z: pos.z, ts: Date.now() };
        void updateCharacterLocation(user.uid, {
          lastX: pos.x,
          lastZ: pos.z,
          lastRotY: pos.rotY,
        }).catch(() => {
          // Non-fatal background location checkpoint
        });
      }
    }
  }, []);

  const saveAppearance = useCallback(
    async (input: UpdateAppearanceInput) => {
      if (!firebaseUser) return;
      await updateCharacterAppearance(firebaseUser.uid, input);
      mpClientRef.current?.sendAppearance(input);
    },
    [firebaseUser]
  );

  const clearVehicleNotice = useCallback(() => {
    setVehicleNotice(null);
  }, []);

  const spawnVehicle = useCallback(async (vehicleId: string): Promise<SharedVehicleState> => {
    const user = firebaseUserRef.current;
    if (!user) {
      throw new Error('Sessão não autenticada.');
    }
    const res = await spawnVehicleToWorld(user, vehicleId);
    setWorldVehicles((prev) => ({
      ...prev,
      [res.vehicle.vehicleId]: res.vehicle,
    }));
    setVehicleNotice({
      type: 'ok',
      text: `${res.vehicle.model} [${res.vehicle.plate}] materializado em ${res.bay.label}. Aproxime-se para entrar.`,
    });
    return res.vehicle;
  }, []);

  const storeVehicle = useCallback(async (vehicleId: string): Promise<void> => {
    const user = firebaseUserRef.current;
    if (!user) {
      throw new Error('Sessão não autenticada.');
    }
    const res = await storeVehicleInGarage(user, vehicleId);
    setWorldVehicles((prev) => {
      if (!prev[vehicleId]) return prev;
      const copy = { ...prev };
      delete copy[vehicleId];
      return copy;
    });
    setDrivingVehicleId((cur) => (cur === vehicleId ? null : cur));
    setVehicleNotice({
      type: 'ok',
      text: `Veículo [${res.plate}] guardado na Garagem Central (${res.mileageKm} km · combustível ${Math.round(res.fuelLevel)}% · conservação ${res.condition}%).`,
    });
  }, []);

  const enterVehicle = useCallback((vehicleId: string) => {
    setVehicleNotice(null);
    mpClientRef.current?.sendVehicleEnter(vehicleId);
  }, []);

  const exitVehicle = useCallback((vehicleId?: string) => {
    const targetId = vehicleId ?? drivingVehicleIdRef.current;
    if (!targetId) return;
    mpClientRef.current?.sendVehicleExit(targetId);
  }, []);

  const reportLocalVehicleMotion = useCallback((payload: VehicleMotionPayload) => {
    latestPosRef.current = { x: payload.x, z: payload.z, rotY: payload.rotY };
    mpClientRef.current?.sendVehicleMotion(payload);

    // Update local vehicle snapshot in state at throttled cadence so HUD gauges stay responsive
    const now = performance.now();
    if (now - coordsUpdateRef.current > 120) {
      coordsUpdateRef.current = now;
      setPlayerCoords({
        x: Math.round(payload.x * 10) / 10,
        z: Math.round(payload.z * 10) / 10,
      });
      setWorldVehicles((prev) => {
        const cur = prev[payload.vehicleId];
        if (!cur) return prev;
        return {
          ...prev,
          [payload.vehicleId]: {
            ...cur,
            x: payload.x,
            z: payload.z,
            rotY: payload.rotY,
            speed: payload.speed,
            steerAngle: payload.steerAngle,
            throttle: payload.throttle,
            braking: payload.braking,
            handbrake: payload.handbrake,
            boost: payload.boost,
            updatedAt: Date.now(),
          },
        };
      });
    }
  }, []);

  const signOutUser = useCallback(async () => {
    // Store any active street vehicle cleanly before signing out so mileage/fuel/condition persist
    const user = firebaseUserRef.current;
    const char = characterRef.current;
    if (user && user.emailVerified && char && char.status === 'active') {
      const ownedActive = Object.values(worldVehiclesRef.current).find(
        (v) => v.ownerUid === user.uid
      );
      if (ownedActive) {
        try {
          await storeVehicleInGarage(user, ownedActive.vehicleId);
        } catch {
          // Server disconnect cleanup will still despawn it safely
        }
      }
      try {
        await updateCharacterLocation(user.uid, {
          lastX: latestPosRef.current.x,
          lastZ: latestPosRef.current.z,
          lastRotY: latestPosRef.current.rotY,
        });
      } catch {
        // Proceed with sign out even if checkpoint fails
      }
    }
    mpClientRef.current?.disconnect();
    mpClientRef.current = null;
    setRemotePlayers({});
    setWorldVehicles({});
    setDrivingVehicleId(null);
    await logoutSession();
  }, []);

  // Derived application stage
  const stage: AppStage = useMemo(() => {
    if (!splashDismissed) return 'splash';
    if (!authReady || !firebaseUser) return 'auth';
    if (!firebaseUser.emailVerified) return 'auth';
    if (characterLoading) return 'auth';
    if (!character) return 'creator';
    return 'game';
  }, [splashDismissed, authReady, firebaseUser, characterLoading, character]);

  const onlineCount = useMemo(() => {
    const remoteTotal = Object.keys(remotePlayers).length;
    return mpConnection === 'connected' ? remoteTotal + 1 : remoteTotal;
  }, [remotePlayers, mpConnection]);

  const activeWorkSession = useMemo(
    () => workSessions.find((s) => s.status === 'in_progress') ?? null,
    [workSessions]
  );

  const mySpawnedVehicle = useMemo(() => {
    if (!firebaseUser) return null;
    return Object.values(worldVehicles).find((v) => v.ownerUid === firebaseUser.uid) ?? null;
  }, [worldVehicles, firebaseUser]);

  const activeDrivenVehicle = useMemo(() => {
    if (!drivingVehicleId) return null;
    return worldVehicles[drivingVehicleId] ?? null;
  }, [worldVehicles, drivingVehicleId]);

  const value = useMemo<GameContextValue>(
    () => ({
      stage,
      enterFromSplash: () => setSplashDismissed(true),
      firebaseUser,
      authReady,
      character,
      characterLoading,
      adminStatus,
      economyConfig,
      wallet,
      bankAccount,
      jobExperience,
      jobsCatalog,
      workSessions,
      activeWorkSession,
      transactions,
      salaryPayments,
      bankDirectory,
      economyReady,
      economyError,
      businessLocations,
      businesses,
      openVacancies,
      myEmployeeContracts,
      myBusinessApplications,
      selectedBusinessId,
      setSelectedBusinessId,
      preferredBusinessTab,
      setPreferredBusinessTab,
      enterBusinessById,
      enterDealershipShowroom,
      vehicleCatalog,
      myVehicles,
      availableDealershipStock,
      activeVehicleListings,
      activeModule,
      setActiveModule,
      remotePlayers,
      worldVehicles,
      drivingVehicleId,
      mySpawnedVehicle,
      activeDrivenVehicle,
      pendingPlayerTeleport,
      vehicleCorrection,
      vehicleNotice,
      clearVehicleNotice,
      spawnVehicle,
      storeVehicle,
      enterVehicle,
      exitVehicle,
      reportLocalVehicleMotion,
      onlineCount,
      mpConnection,
      playerCoords,
      reportLocalPosition,
      saveAppearance,
      refreshEconomyConfig,
      refreshAdminStatus,
      graphicsPreset,
      setGraphicsPreset,
      cameraPreset,
      setCameraPreset,
      signOutUser,
    }),
    [
      stage,
      firebaseUser,
      authReady,
      character,
      characterLoading,
      adminStatus,
      economyConfig,
      wallet,
      bankAccount,
      jobExperience,
      jobsCatalog,
      workSessions,
      activeWorkSession,
      transactions,
      salaryPayments,
      bankDirectory,
      economyReady,
      economyError,
      businessLocations,
      businesses,
      openVacancies,
      myEmployeeContracts,
      myBusinessApplications,
      selectedBusinessId,
      preferredBusinessTab,
      enterBusinessById,
      enterDealershipShowroom,
      vehicleCatalog,
      myVehicles,
      availableDealershipStock,
      activeVehicleListings,
      activeModule,
      setActiveModule,
      remotePlayers,
      worldVehicles,
      drivingVehicleId,
      mySpawnedVehicle,
      activeDrivenVehicle,
      pendingPlayerTeleport,
      vehicleCorrection,
      vehicleNotice,
      clearVehicleNotice,
      spawnVehicle,
      storeVehicle,
      enterVehicle,
      exitVehicle,
      reportLocalVehicleMotion,
      onlineCount,
      mpConnection,
      playerCoords,
      reportLocalPosition,
      saveAppearance,
      refreshEconomyConfig,
      refreshAdminStatus,
      graphicsPreset,
      cameraPreset,
      signOutUser,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) {
    throw new Error('useGame deve ser utilizado dentro de GameProvider.');
  }
  return ctx;
}
