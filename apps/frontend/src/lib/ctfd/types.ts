/**
 * Types internes du front. Ils ne reflètent PAS directement l'API CTFd : toute réponse brute
 * passe par `adapter.ts`, seul fichier à modifier si l'API réelle (apps/ctfd/API.md) diverge.
 */
import type { Role } from "../roles";

export type { Role };

export interface SsoClaims {
  sub: string;
  email: string;
  preferred_username: string;
  groups: string[];
}

export interface SsoSession {
  token: string;
  /** Échéance du token CTFd, en millisecondes epoch. */
  expiresAt: number;
  userId: number;
  name: string;
  email: string | null;
  teamId: number | null;
  teamName: string | null;
  role: Role;
}

export const DIFFICULTIES = ["easy", "medium", "hard", "insane"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type FirstBlood = "mine" | "other" | null;

/** Premier solve d'un challenge (`GET /api/v1/pad/first-bloods`, plugin pad_public). */
export interface FirstBloodInfo {
  /** Équipe en mode équipes, joueur sinon. */
  accountId: number;
  accountName: string;
  userName: string | null;
  date: string;
}

export interface ChallengeSummary {
  id: number;
  name: string;
  category: string;
  value: number;
  solves: number;
  solvedByMe: boolean;
  attempted: boolean;
  firstBlood: FirstBlood;
  /** Qui a pris le first blood (null : aucun solve, ou plugin indisponible). */
  firstBloodBy: FirstBloodInfo | null;
  difficulty: Difficulty | null;
  tags: string[];
  instanced: boolean;
}

export interface ChallengeFile {
  name: string;
  /** Chemin relatif servi par le BFF (`/api/files/...`), jamais l'URL CTFd brute. */
  href: string;
}

export interface Hint {
  id: number;
  cost: number;
  content: string | null;
  unlocked: boolean;
}

export interface ChallengeDetail extends ChallengeSummary {
  description: string;
  connectionInfo: string | null;
  files: ChallengeFile[];
  hints: Hint[];
  maxAttempts: number;
  attempts: number;
}

export type AttemptStatus = "correct" | "incorrect" | "already_solved" | "paused" | "ratelimited";

export interface AttemptResult {
  status: AttemptStatus;
  message: string;
}

export interface ScoreboardEntry {
  pos: number;
  accountId: number;
  name: string;
  score: number;
  memberCount: number;
}

export interface ScorePoint {
  t: number; // epoch ms
  score: number;
}

export interface ScoreSeries {
  accountId: number;
  name: string;
  points: ScorePoint[];
}

export interface Me {
  id: number;
  name: string;
  email: string | null;
  teamId: number | null;
  score: number;
  place: number | null;
  affiliation: string | null;
  country: string | null;
}

export interface TeamMember {
  id: number;
  name: string;
  score: number;
}

export interface Team {
  id: number;
  name: string;
  score: number;
  place: number | null;
  captainId: number | null;
  members: TeamMember[];
}

export interface Solve {
  challengeId: number;
  challengeName: string;
  category: string;
  value: number;
  date: string;
  userName: string | null;
}

export interface Fail {
  challengeId: number;
  date: string;
}

export interface Notification {
  id: number;
  title: string;
  content: string;
  date: string;
}

/** Instance chall-manager d'une équipe (ou d'un joueur) telle que l'expose le plugin `chall_manager_bridge`. */
export interface Instance {
  challengeId: number;
  sourceId: string | null;
  connectionInfo: string | null;
  since: string | null;
  lastRenew: string | null;
  /** Échéance ISO (les nanosecondes de chall-manager sont tronquées à la milliseconde). */
  until: string | null;
  /** Secondes restantes au moment de la réponse. */
  expiresIn: number | null;
  renewals: number;
  maxRenewals: number | null;
  renewalsLeft: number | null;
  perInstanceFlag: boolean;
}

export interface ChallengeStats {
  id: number;
  name: string;
  category: string;
  type: string;
  state: string;
  value: number;
  solves: number;
  attempts: number;
  incorrectAttempts: number;
  /** solves / attempts, entre 0 et 1. */
  successRate: number;
  firstBlood: { accountName: string; userName: string | null; date: string } | null;
  bucket: "hour" | "day";
  solvesOverTime: { t: string; solves: number; cumulative: number }[];
}

export interface ManagedChallenge {
  id: number;
  name: string;
  category: string;
  value: number;
  type: string;
  state: string;
  instanced: boolean;
  tags: string[];
  solves: number;
  attempts: number;
  successRate: number;
}

export interface ManagedSummary {
  count: number;
  solves: number;
  attempts: number;
  successRate: number;
}

export interface ImportResult {
  id: number;
  name: string;
  action: "created" | "updated";
  type: string;
  state: string;
  value: number;
  instance: boolean;
  flags: number;
  hints: number;
  tags: number;
  files: string[];
  filesUploaded: string[];
}

export const EVENT_STATES = ["not_started", "running", "paused", "frozen", "ended"] as const;
export type EventState = (typeof EVENT_STATES)[number];

/** Événement CTF (`/api/v1/manager/event`). Dates en ISO 8601 UTC. */
export interface EventConfig {
  start: string | null;
  end: string | null;
  freeze: string | null;
  paused: boolean;
  state: EventState;
}

/** Page de résultats des listes `manager_api` (`meta.total` = taille totale, toutes pages). */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface ModerationQuery {
  page?: number;
  perPage?: number;
  q?: string;
}

export interface AdminUser {
  id: number;
  name: string;
  email: string | null;
  teamId: number | null;
  teamName: string | null;
  roles: string[];
  banned: boolean;
  hidden: boolean;
}

export interface AdminSubmission {
  id: number;
  type: string;
  challengeId: number | null;
  challengeName: string | null;
  userName: string | null;
  teamName: string | null;
  date: string;
}

export interface AdminAward {
  id: number;
  name: string;
  value: number;
  userName: string | null;
  teamName: string | null;
  date: string;
}

export interface AdminTeam {
  id: number;
  name: string;
  memberCount: number;
  banned: boolean;
  hidden: boolean;
}
