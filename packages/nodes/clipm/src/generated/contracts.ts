/* Generated from the Pydantic ClipM contract. Do not edit. */

export type Schemaversion = 1;
export type Workid = string;
export type Recordnumber = number;
export type Shortcode = string;
export type Firstseenname = string;
export type Currentbasename = string;
export type Namerevision = number;
export type Bundleversion = number;
export type CmLabel = "P" | "N";
export type ValueSource = "model" | "filename" | "gui" | "neoview" | "json";
export type Predicted = number;
export type Current = number;
export type Probability = number | null;
export type Scoredat = string;
export type Encoder = "google/siglip2-base-patch16-224";
export type Preprocess = "white-letterbox-224/four-of-twelve/color-mono-v1";
export type Dtype = "float16";
/**
 * @minItems 1
 * @maxItems 1
 */
export type Shape = [768];
export type Encoding = "base64";
export type Data = string;
export type ArchiveFormat = "zip" | "cbz" | "7z" | "cb7" | "rar" | "cbr" | "directory";
export type MetadataWriteStatus = "written" | "unsupported" | "skipped" | "failed";
export type Revision = number;
export type Previousname = string;
export type Currentname = string;
export type Changedat = string;
export type Namehistory = NameHistoryEntry[];
export type Eventid = string;
export type Occurredat = string;
export type FeedbackOrigin = "filename" | "gui" | "neoview";
export type Rankingbefore = number | null;
export type Rankingafter = number | null;
export type Undoneby = string | null;
export type Feedbackhistory = FeedbackHistoryEntry[];
export type Path = string;
export type Rescore = boolean;
export type Rename = boolean;
export type Writemetadata = boolean;
export type Dryrun = boolean;
export type Path1 = string;
export type Path2 = string;
export type Workid1 = string;
export type Ranking = number | null;
export type ReviewStatus = "pending" | "resolved";
export type Limit = number;
export type Reviewid = string;
export type ReviewResolution = "use_filename" | "use_json" | "link_existing" | "new_work";
export type Existingworkid = string | null;
export type Forceimmediate = boolean;
export type Includefailed = boolean;
export type Bundleversion1 = number;
export type Force = boolean;
export type Bundleversion2 = number;
export type Includearchivetools = boolean;
export type Targetruntimeroot = string;
export type Workid2 = string;
export type Path3 = string;
export type Score = number;
export type Bundleversion3 = number;
export type Shortcode1 = string;
export type Stale = boolean;
export type Taskid = string;
export type Acceptedat = string;
export type Reviewid1 = string;
export type ReviewKind = "invalid_suffix" | "identity_conflict" | "short_code_conflict" | "recovery_candidate";
export type ReviewStatus1 = "pending" | "resolved";
export type Workid3 = string | null;
export type Path4 = string;
export type Createdat = string;
export type Bundleversion4 = number;
export type ModelBundleStatus = "candidate" | "active" | "inactive" | "failed";
export type Datarevision = number;
export type Createdat1 = string;
export type Pinned = boolean;
export type Runtimeroot = string;
export type Pythonversion = string;
export type DevicePreference = "cuda" | "cpu";
export type Cudaavailable = boolean;
export type ModelResidency = "immediate" | "idle-10m" | "worker";
export type Activebundleversion = number | null;
export type Databaseok = boolean;
export type Sevenzipavailable = boolean;
export type Raravailable = boolean;
export type Warnings = string[];

/**
 * Generated catalog of ClipM MCP and persistence wire contracts.
 */
export interface ClipmContractCatalog {
  CmScoreDocument?: CmScoreDocument;
  ScoreLibraryCommand?: ScoreLibraryCommand;
  ScoreWorkCommand?: ScoreWorkCommand;
  ScanFeedbackCommand?: ScanFeedbackCommand;
  ApplyFeedbackCommand?: ApplyFeedbackCommand;
  ListReviewItemsCommand?: ListReviewItemsCommand;
  ResolveReviewItemCommand?: ResolveReviewItemCommand;
  TrainHeadsCommand?: TrainHeadsCommand;
  ListModelsCommand?: ListModelsCommand;
  ActivateModelCommand?: ActivateModelCommand;
  RollbackModelCommand?: RollbackModelCommand;
  EnvironmentStatusCommand?: EnvironmentStatusCommand;
  MigrateEnvironmentCommand?: MigrateEnvironmentCommand;
  WorkScoreResult?: WorkScoreResult;
  TaskReference?: TaskReference;
  ReviewItem?: ReviewItem;
  ModelSummary?: ModelSummary;
  EnvironmentStatus?: EnvironmentStatus;
}
export interface CmScoreDocument {
  schemaVersion: Schemaversion;
  work: WorkIdentity;
  score: ScoreSnapshot;
  embedding: EmbeddingPayload;
  archive: ArchiveSnapshot;
  nameHistory?: Namehistory;
  feedbackHistory?: Feedbackhistory;
}
export interface WorkIdentity {
  workId: Workid;
  recordNumber: Recordnumber;
  shortCode: Shortcode;
  firstSeenName: Firstseenname;
  currentBaseName: Currentbasename;
  nameRevision: Namerevision;
}
export interface ScoreSnapshot {
  bundleVersion: Bundleversion;
  classification: ClassificationSnapshot;
  ranking: RankingSnapshot;
  probability?: Probability;
  scoredAt: Scoredat;
}
export interface ClassificationSnapshot {
  predicted: CmLabel;
  current: CmLabel;
  source: ValueSource;
}
export interface RankingSnapshot {
  predicted: Predicted;
  current: Current;
  source: ValueSource;
}
export interface EmbeddingPayload {
  encoder: Encoder;
  preprocess: Preprocess;
  dtype: Dtype;
  shape: Shape;
  encoding: Encoding;
  data: Data;
}
export interface ArchiveSnapshot {
  format: ArchiveFormat;
  metadataWriteStatus: MetadataWriteStatus;
}
export interface NameHistoryEntry {
  revision: Revision;
  previousName: Previousname;
  currentName: Currentname;
  changedAt: Changedat;
  source: ValueSource;
}
export interface FeedbackHistoryEntry {
  eventId: Eventid;
  occurredAt: Occurredat;
  source: FeedbackOrigin;
  classificationBefore?: CmLabel | null;
  classificationAfter?: CmLabel | null;
  rankingBefore?: Rankingbefore;
  rankingAfter?: Rankingafter;
  undoneBy?: Undoneby;
}
export interface ScoreLibraryCommand {
  path: Path;
  options?: ScoreOptions;
}
export interface ScoreOptions {
  rescore?: Rescore;
  rename?: Rename;
  writeMetadata?: Writemetadata;
  dryRun?: Dryrun;
}
export interface ScoreWorkCommand {
  path: Path1;
  options?: ScoreOptions;
}
export interface ScanFeedbackCommand {
  path: Path2;
}
export interface ApplyFeedbackCommand {
  workId: Workid1;
  classification?: CmLabel | null;
  ranking?: Ranking;
  source: FeedbackOrigin;
}
export interface ListReviewItemsCommand {
  status?: ReviewStatus;
  limit?: Limit;
}
export interface ResolveReviewItemCommand {
  reviewId: Reviewid;
  resolution: ReviewResolution;
  existingWorkId?: Existingworkid;
}
export interface TrainHeadsCommand {
  forceImmediate?: Forceimmediate;
}
export interface ListModelsCommand {
  includeFailed?: Includefailed;
}
export interface ActivateModelCommand {
  bundleVersion: Bundleversion1;
  force?: Force;
}
export interface RollbackModelCommand {
  bundleVersion: Bundleversion2;
}
export interface EnvironmentStatusCommand {
  includeArchiveTools?: Includearchivetools;
}
export interface MigrateEnvironmentCommand {
  targetRuntimeRoot: Targetruntimeroot;
}
export interface WorkScoreResult {
  workId: Workid2;
  path: Path3;
  label: CmLabel;
  score: Score;
  bundleVersion: Bundleversion3;
  shortCode: Shortcode1;
  stale?: Stale;
}
export interface TaskReference {
  taskId: Taskid;
  acceptedAt: Acceptedat;
}
export interface ReviewItem {
  reviewId: Reviewid1;
  kind: ReviewKind;
  status: ReviewStatus1;
  workId?: Workid3;
  path: Path4;
  details: Details;
  createdAt: Createdat;
}
export interface Details {
  [k: string]: unknown;
}
export interface ModelSummary {
  bundleVersion: Bundleversion4;
  status: ModelBundleStatus;
  classificationMetrics?: Classificationmetrics;
  rankingMetrics?: Rankingmetrics;
  dataRevision: Datarevision;
  createdAt: Createdat1;
  pinned?: Pinned;
}
export interface Classificationmetrics {
  [k: string]: number;
}
export interface Rankingmetrics {
  [k: string]: number;
}
export interface EnvironmentStatus {
  runtimeRoot: Runtimeroot;
  pythonVersion: Pythonversion;
  device: DevicePreference;
  cudaAvailable: Cudaavailable;
  modelResidency: ModelResidency;
  activeBundleVersion?: Activebundleversion;
  databaseOk: Databaseok;
  sevenZipAvailable: Sevenzipavailable;
  rarAvailable: Raravailable;
  warnings?: Warnings;
}
