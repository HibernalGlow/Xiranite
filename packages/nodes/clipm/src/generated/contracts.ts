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
/**
 * @minItems 1
 * @maxItems 500
 */
export type Directorypaths = [string, ...string[]];
export type Path3 = string;
export type Workid1 = string;
export type Ranking = number | null;
export type Workid2 = string | null;
export type Includeundone = boolean;
export type Limit = number;
export type Beforeoccurredat = string | null;
export type Beforeeventid = string | null;
export type Eventid1 = string;
export type FeedbackOrigin1 = "filename" | "gui" | "neoview";
export type Path4 = string;
export type ReviewStatus = "pending" | "resolved";
export type Limit1 = number;
export type Limit2 = number;
export type Maxworks = number;
export type Reviewid = string;
export type ReviewResolution = "use_filename" | "use_json" | "link_existing" | "new_work";
export type Existingworkid = string | null;
export type Allowinsufficientrankingcorrections = boolean;
export type Batchsize = number;
export type Includefailed = boolean;
export type Bundleversion1 = number;
export type Force = boolean;
export type Bundleversion2 = number;
export type Includearchivetools = boolean;
export type Targetruntimeroot = string;
export type Workid3 = string;
export type Path5 = string;
export type Sourcepath = string | null;
export type Score = number;
export type Predictedscore = number | null;
export type Classificationcorrected = boolean;
export type Rankingcorrected = boolean;
export type Probability1 = number | null;
export type Bundleversion3 = number;
export type Shortcode1 = string;
export type Sampledpages = string[];
export type Candidatepagecount = number;
export type Pagecount = number;
export type MetadataWriteStatus1 = "written" | "unsupported" | "skipped" | "failed";
export type Renamed = boolean;
export type Stale = boolean;
export type Simulated = boolean;
export type Plannedrename = boolean;
export type Plannedmetadatawrite = boolean;
export type Path6 = string;
export type Directorypath = string;
export type Directories = DirectoryScoreResult[];
export type Path7 = string;
export type Errortype = string;
export type Message = string;
export type Path8 = string;
export type Discoveredworkcount = number;
export type Succeededworkcount = number;
export type Failedworkcount = number;
export type Path9 = string;
export type Scannedworkcount = number;
export type Synchronizedworkcount = number;
export type Importedfeedbackcount = number;
export type Importedfeedback = FeedbackApplyResult[];
export type Reviewid1 = string;
export type ReviewKind = "invalid_suffix" | "identity_conflict" | "short_code_conflict" | "recovery_candidate";
export type ReviewStatus1 = "pending" | "resolved";
export type Workid4 = string | null;
export type Path10 = string;
export type Createdat = string;
export type Resolvedat = string | null;
export type Reviewitems = ReviewItem[];
export type Works = WorkScoreResult[];
export type Works1 = WorkScoreResult[];
export type Failures = WorkScoreFailure[];
export type Taskid = string;
export type Acceptedat = string;
export type Items = ReviewItem[];
export type Workid5 = string;
export type Candidateworkid = string;
export type Workpath = string | null;
export type Candidatepath = string | null;
export type Meansimilarity = number;
export type Matchedpagecount = number;
export type Querypagecount = number;
export type Candidatepagecount1 = number;
export type Observedat = string;
export type Runid = string;
export type Status = "accepted" | "rejected" | "failed" | "cancelled";
export type Candidategenerationenabled = boolean;
export type Threshold = number | null;
export type Evidenceworkcount = number;
export type Evaluatedworkcount = number;
export type Positivesamplecount = number;
export type Negativesamplecount = number;
export type Positiverecall = number | null;
export type Negativeceiling = number | null;
export type Safetymargin = number;
export type Reasons = string[];
export type Reviewitemcount = number;
export type Candidategenerationenabled1 = boolean;
export type Threshold1 = number | null;
export type Calibrationstatus = "collecting_telemetry" | "calibrated";
export type Embeddedworkcount = number;
export type Observationcount = number;
export type Observations = PerceptualRecoveryObservation[];
export type Eventid2 = string;
export type Occurredat1 = string;
export type Rankingbefore1 = number | null;
export type Rankingafter1 = number | null;
export type Undoneby1 = string | null;
export type Workid6 = string;
export type Currentpath = string | null;
export type Undoapplicable = boolean;
export type Events = FeedbackEventRecord[];
export type Hasmore = boolean;
export type Nextbeforeoccurredat = string | null;
export type Nextbeforeeventid = string | null;
export type Bundleversion4 = number;
export type ModelBundleStatus = "candidate" | "active" | "inactive" | "failed";
export type Datarevision = number;
export type Createdat1 = string;
export type Pinned = boolean;
export type Classificationvalidationstatus = "accepted" | "rejected" | "imported";
export type Classificationvalidationreasons = string[];
export type Rankingvalidationstatus = ("accepted" | "rejected") | null;
export type Rankingvalidationreasons = string[];
export type Models = ModelSummary[];
export type Activebundleversion = number | null;
export type Runid1 = string;
export type Datarevision1 = number;
export type Status1 = "accepted" | "rejected" | "skipped";
export type Reasons1 = string[];
export type Bundleversion5 = number | null;
export type Activebundleversion1 = number;
export type Status2 = "not_ready" | "attempted";
export type Batchsize1 = number;
export type Pendingworkcount = number;
export type Batchid = string | null;
export type Originalpath = string;
export type Finalpath = string;
export type Workid7 = string | null;
export type Databaseremoved = boolean;
export type Metadataremoved = boolean;
export type Renamed1 = boolean;
export type Previousbundleversion = number | null;
export type Activebundleversion2 = number;
export type Forced = boolean;
export type Schemaversion1 = 1;
export type Bundleversion6 = number;
export type Encoder1 = "google/siglip2-base-patch16-224";
export type Encoderrevision = string;
export type Preprocess1 = "white-letterbox-224/four-of-twelve/color-mono-v1";
export type Pooling = "page-l2/mean/work-l2";
export type Kind = "standard-scaler-logistic-regression";
export type Featuredimension = 768;
export type Regularizationc = number;
export type Classweight = "balanced";
export type Threshold2 = number;
export type Samples = number;
export type Positivesamples = number;
export type Negativesamples = number;
export type Rocauc = number;
export type Macroaverageprecision = number;
export type Balancedaccuracy = number;
export type Correctionsamples = number;
export type Oofsplits = number;
export type Activecorrectionlogloss = number | null;
export type Candidatecorrectionlogloss = number | null;
export type Activevalidationrocauc = number | null;
export type Activevalidationbalancedaccuracy = number | null;
export type Activevalidationmacroaverageprecision = number | null;
export type Validationstatus = "accepted" | "rejected" | "imported";
export type Validationreasons = string[];
export type Kind1 = "standard-scaler-ridge-cv";
export type Featuredimension1 = 768;
export type Alpha = number;
export type Correctionsamples1 = number;
export type Oofsplits1 = number;
export type Baselineweightedmae = number;
export type Candidateweightedmae = number;
export type Baselinespearman = number;
export type Candidatespearman = number;
export type Validationstatus1 = "accepted" | "rejected";
export type Validationreasons1 = string[];
export type Weightssha256 = string;
export type Kind2 = "trusted-joblib-import" | "head-training";
export type Filename = string | null;
export type Sha256 = string | null;
export type Trainingrunid = string | null;
export type Parentbundleversion = number | null;
export type Trainedhead = ("classification" | "ranking") | null;
export type Createdat2 = string;
export type Schemaversion2 = 1;
export type Bundleversion7 = number;
export type Activatedat = string;
export type Healthy = boolean;
export type Serviceversion = string;
export type Runtimeroot = string;
export type Pythonversion = string;
export type DevicePreference = "cuda" | "cpu";
export type Cudaavailable = boolean;
export type Modelavailable = boolean;
export type ModelResidency = "immediate" | "idle-10m" | "worker";
export type Activebundleversion3 = number | null;
export type Databaseok = boolean;
export type Sevenzipavailable = boolean;
export type Raravailable = boolean;
export type Warnings = string[];
export type Sourceruntimeroot = string;
export type Targetruntimeroot1 = string;
export type Pythonenvironmentrecreated = boolean;
export type Copiedcomponents = ("database" | "models" | "training" | "huggingface-cache" | "uv-cache")[];
export type Warnings1 = string[];

/**
 * Generated catalog of ClipM MCP and persistence wire contracts.
 */
export interface ClipmContractCatalog {
  CmScoreDocument?: CmScoreDocument;
  ScoreLibraryCommand?: ScoreLibraryCommand;
  ScoreWorkCommand?: ScoreWorkCommand;
  GetWorkScoreCommand?: GetWorkScoreCommand;
  GetDirectoryScoresCommand?: GetDirectoryScoresCommand;
  ScanFeedbackCommand?: ScanFeedbackCommand;
  ApplyFeedbackCommand?: ApplyFeedbackCommand;
  ListFeedbackEventsCommand?: ListFeedbackEventsCommand;
  UndoFeedbackCommand?: UndoFeedbackCommand;
  RemoveWorkMetadataCommand?: RemoveWorkMetadataCommand;
  ListReviewItemsCommand?: ListReviewItemsCommand;
  PerceptualRecoveryStatusCommand?: PerceptualRecoveryStatusCommand;
  CalibratePerceptualRecoveryCommand?: CalibratePerceptualRecoveryCommand;
  ResolveReviewItemCommand?: ResolveReviewItemCommand;
  TrainHeadsCommand?: TrainHeadsCommand;
  RunAutoTrainingCommand?: RunAutoTrainingCommand;
  ListModelsCommand?: ListModelsCommand;
  ActivateModelCommand?: ActivateModelCommand;
  RollbackModelCommand?: RollbackModelCommand;
  EnvironmentStatusCommand?: EnvironmentStatusCommand;
  MigrateEnvironmentCommand?: MigrateEnvironmentCommand;
  WorkScoreResult?: WorkScoreResult;
  WorkScoreLookupResult?: WorkScoreLookupResult;
  DirectoryScoreResult?: DirectoryScoreResult;
  DirectoryScoresResult?: DirectoryScoresResult;
  WorkScoreFailure?: WorkScoreFailure;
  ScoreLibraryResult?: ScoreLibraryResult;
  TaskReference?: TaskReference;
  ReviewItem?: ReviewItem;
  ReviewItemsResult?: ReviewItemsResult;
  PerceptualRecoveryObservation?: PerceptualRecoveryObservation;
  PerceptualCalibrationResult?: PerceptualCalibrationResult;
  PerceptualRecoveryStatus?: PerceptualRecoveryStatus;
  FeedbackApplyResult?: FeedbackApplyResult;
  FeedbackEventRecord?: FeedbackEventRecord;
  FeedbackEventsResult?: FeedbackEventsResult;
  FeedbackScanResult?: FeedbackScanResult;
  ModelSummary?: ModelSummary;
  ModelsResult?: ModelsResult;
  TrainingResult?: TrainingResult;
  AutoTrainingResult?: AutoTrainingResult;
  RemoveWorkMetadataResult?: RemoveWorkMetadataResult;
  ModelActivationResult?: ModelActivationResult;
  ModelBundleManifest?: ModelBundleManifest;
  ActiveModelPointer?: ActiveModelPointer;
  EnvironmentStatus?: EnvironmentStatus;
  EnvironmentMigrationResult?: EnvironmentMigrationResult;
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
export interface GetWorkScoreCommand {
  path: Path2;
}
export interface GetDirectoryScoresCommand {
  directoryPaths: Directorypaths;
}
export interface ScanFeedbackCommand {
  path: Path3;
}
export interface ApplyFeedbackCommand {
  workId: Workid1;
  classification?: CmLabel | null;
  ranking?: Ranking;
  source: FeedbackOrigin;
}
export interface ListFeedbackEventsCommand {
  workId?: Workid2;
  includeUndone?: Includeundone;
  limit?: Limit;
  beforeOccurredAt?: Beforeoccurredat;
  beforeEventId?: Beforeeventid;
}
export interface UndoFeedbackCommand {
  eventId: Eventid1;
  source?: FeedbackOrigin1;
}
export interface RemoveWorkMetadataCommand {
  path: Path4;
}
export interface ListReviewItemsCommand {
  status?: ReviewStatus;
  limit?: Limit1;
}
export interface PerceptualRecoveryStatusCommand {
  limit?: Limit2;
}
export interface CalibratePerceptualRecoveryCommand {
  maxWorks?: Maxworks;
}
export interface ResolveReviewItemCommand {
  reviewId: Reviewid;
  resolution: ReviewResolution;
  existingWorkId?: Existingworkid;
}
export interface TrainHeadsCommand {
  allowInsufficientRankingCorrections?: Allowinsufficientrankingcorrections;
}
export interface RunAutoTrainingCommand {
  batchSize?: Batchsize;
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
  workId: Workid3;
  path: Path5;
  sourcePath?: Sourcepath;
  label: CmLabel;
  score: Score;
  predictedLabel?: CmLabel | null;
  predictedScore?: Predictedscore;
  classificationCorrected?: Classificationcorrected;
  rankingCorrected?: Rankingcorrected;
  probability?: Probability1;
  bundleVersion: Bundleversion3;
  shortCode: Shortcode1;
  sampledPages?: Sampledpages;
  candidatePageCount?: Candidatepagecount;
  pageCount?: Pagecount;
  metadataWriteStatus?: MetadataWriteStatus1;
  renamed?: Renamed;
  stale?: Stale;
  simulated?: Simulated;
  plannedRename?: Plannedrename;
  plannedMetadataWrite?: Plannedmetadatawrite;
}
export interface WorkScoreLookupResult {
  path: Path6;
  work?: WorkScoreResult | null;
}
export interface DirectoryScoreResult {
  directoryPath: Directorypath;
  work?: WorkScoreResult | null;
}
export interface DirectoryScoresResult {
  directories: Directories;
}
export interface WorkScoreFailure {
  path: Path7;
  errorType: Errortype;
  message: Message;
}
export interface ScoreLibraryResult {
  path: Path8;
  discoveredWorkCount: Discoveredworkcount;
  succeededWorkCount: Succeededworkcount;
  failedWorkCount: Failedworkcount;
  feedback: FeedbackScanResult;
  works?: Works1;
  failures?: Failures;
}
export interface FeedbackScanResult {
  path: Path9;
  scannedWorkCount: Scannedworkcount;
  synchronizedWorkCount: Synchronizedworkcount;
  importedFeedbackCount: Importedfeedbackcount;
  importedFeedback?: Importedfeedback;
  reviewItems?: Reviewitems;
  works?: Works;
}
export interface FeedbackApplyResult {
  work: WorkScoreResult;
  event?: FeedbackHistoryEntry | null;
}
export interface ReviewItem {
  reviewId: Reviewid1;
  kind: ReviewKind;
  status: ReviewStatus1;
  workId?: Workid4;
  path: Path10;
  details: Details;
  createdAt: Createdat;
  resolution?: ReviewResolution | null;
  resolvedAt?: Resolvedat;
}
export interface Details {
  [k: string]: unknown;
}
export interface TaskReference {
  taskId: Taskid;
  acceptedAt: Acceptedat;
}
export interface ReviewItemsResult {
  items: Items;
}
export interface PerceptualRecoveryObservation {
  workId: Workid5;
  candidateWorkId: Candidateworkid;
  workPath?: Workpath;
  candidatePath?: Candidatepath;
  meanSimilarity: Meansimilarity;
  matchedPageCount: Matchedpagecount;
  queryPageCount: Querypagecount;
  candidatePageCount: Candidatepagecount1;
  observedAt: Observedat;
}
export interface PerceptualCalibrationResult {
  runId: Runid;
  status: Status;
  candidateGenerationEnabled: Candidategenerationenabled;
  threshold?: Threshold;
  evidenceWorkCount: Evidenceworkcount;
  evaluatedWorkCount: Evaluatedworkcount;
  positiveSampleCount: Positivesamplecount;
  negativeSampleCount: Negativesamplecount;
  positiveRecall?: Positiverecall;
  negativeCeiling?: Negativeceiling;
  safetyMargin: Safetymargin;
  reasons?: Reasons;
  reviewItemCount?: Reviewitemcount;
}
export interface PerceptualRecoveryStatus {
  candidateGenerationEnabled: Candidategenerationenabled1;
  threshold?: Threshold1;
  calibrationStatus: Calibrationstatus;
  embeddedWorkCount: Embeddedworkcount;
  observationCount: Observationcount;
  lastCalibration?: PerceptualCalibrationResult | null;
  observations?: Observations;
}
export interface FeedbackEventRecord {
  eventId: Eventid2;
  occurredAt: Occurredat1;
  source: FeedbackOrigin;
  classificationBefore?: CmLabel | null;
  classificationAfter?: CmLabel | null;
  rankingBefore?: Rankingbefore1;
  rankingAfter?: Rankingafter1;
  undoneBy?: Undoneby1;
  workId: Workid6;
  currentPath?: Currentpath;
  undoApplicable: Undoapplicable;
}
export interface FeedbackEventsResult {
  events?: Events;
  hasMore?: Hasmore;
  nextBeforeOccurredAt?: Nextbeforeoccurredat;
  nextBeforeEventId?: Nextbeforeeventid;
}
export interface ModelSummary {
  bundleVersion: Bundleversion4;
  status: ModelBundleStatus;
  classificationMetrics?: Classificationmetrics;
  rankingMetrics?: Rankingmetrics;
  dataRevision: Datarevision;
  createdAt: Createdat1;
  pinned?: Pinned;
  classificationValidationStatus: Classificationvalidationstatus;
  classificationValidationReasons?: Classificationvalidationreasons;
  rankingValidationStatus?: Rankingvalidationstatus;
  rankingValidationReasons?: Rankingvalidationreasons;
}
export interface Classificationmetrics {
  [k: string]: number;
}
export interface Rankingmetrics {
  [k: string]: number;
}
export interface ModelsResult {
  models: Models;
  activeBundleVersion?: Activebundleversion;
}
export interface TrainingResult {
  runId: Runid1;
  dataRevision: Datarevision1;
  classification: HeadTrainingResult;
  ranking: HeadTrainingResult;
  activeBundleVersion: Activebundleversion1;
}
export interface HeadTrainingResult {
  status: Status1;
  reasons?: Reasons1;
  bundleVersion?: Bundleversion5;
}
export interface AutoTrainingResult {
  status: Status2;
  batchSize: Batchsize1;
  pendingWorkCount: Pendingworkcount;
  batchId?: Batchid;
  training?: TrainingResult | null;
}
export interface RemoveWorkMetadataResult {
  originalPath: Originalpath;
  finalPath: Finalpath;
  workId?: Workid7;
  databaseRemoved: Databaseremoved;
  metadataRemoved: Metadataremoved;
  renamed: Renamed1;
}
export interface ModelActivationResult {
  previousBundleVersion?: Previousbundleversion;
  activeBundleVersion: Activebundleversion2;
  forced?: Forced;
}
export interface ModelBundleManifest {
  schemaVersion: Schemaversion1;
  bundleVersion: Bundleversion6;
  encoder: Encoder1;
  encoderRevision: Encoderrevision;
  preprocess: Preprocess1;
  pooling: Pooling;
  classificationHead: ClassificationHeadManifest;
  rankingHead?: RankingHeadManifest | null;
  weightsSha256: Weightssha256;
  source: ModelBundleSource;
  createdAt: Createdat2;
}
export interface ClassificationHeadManifest {
  kind: Kind;
  featureDimension: Featuredimension;
  regularizationC: Regularizationc;
  classWeight: Classweight;
  threshold: Threshold2;
  metrics: PilotMetrics;
  validationStatus?: Validationstatus;
  validationReasons?: Validationreasons;
}
export interface PilotMetrics {
  samples: Samples;
  positiveSamples: Positivesamples;
  negativeSamples: Negativesamples;
  rocAuc: Rocauc;
  macroAveragePrecision: Macroaverageprecision;
  balancedAccuracy: Balancedaccuracy;
  correctionSamples?: Correctionsamples;
  oofSplits?: Oofsplits;
  activeCorrectionLogLoss?: Activecorrectionlogloss;
  candidateCorrectionLogLoss?: Candidatecorrectionlogloss;
  activeValidationRocAuc?: Activevalidationrocauc;
  activeValidationBalancedAccuracy?: Activevalidationbalancedaccuracy;
  activeValidationMacroAveragePrecision?: Activevalidationmacroaverageprecision;
}
export interface RankingHeadManifest {
  kind: Kind1;
  featureDimension: Featuredimension1;
  alpha: Alpha;
  metrics: RankingHeadMetrics;
  validationStatus: Validationstatus1;
  validationReasons?: Validationreasons1;
}
export interface RankingHeadMetrics {
  correctionSamples: Correctionsamples1;
  oofSplits: Oofsplits1;
  baselineWeightedMae: Baselineweightedmae;
  candidateWeightedMae: Candidateweightedmae;
  baselineSpearman: Baselinespearman;
  candidateSpearman: Candidatespearman;
}
export interface ModelBundleSource {
  kind: Kind2;
  fileName?: Filename;
  sha256?: Sha256;
  trainingRunId?: Trainingrunid;
  parentBundleVersion?: Parentbundleversion;
  trainedHead?: Trainedhead;
}
export interface ActiveModelPointer {
  schemaVersion: Schemaversion2;
  bundleVersion: Bundleversion7;
  activatedAt: Activatedat;
}
export interface EnvironmentStatus {
  healthy: Healthy;
  serviceVersion: Serviceversion;
  runtimeRoot: Runtimeroot;
  pythonVersion: Pythonversion;
  device: DevicePreference;
  cudaAvailable: Cudaavailable;
  modelAvailable: Modelavailable;
  modelResidency: ModelResidency;
  activeBundleVersion?: Activebundleversion3;
  databaseOk: Databaseok;
  sevenZipAvailable: Sevenzipavailable;
  rarAvailable: Raravailable;
  warnings?: Warnings;
}
export interface EnvironmentMigrationResult {
  sourceRuntimeRoot: Sourceruntimeroot;
  targetRuntimeRoot: Targetruntimeroot1;
  sourceStatus: EnvironmentStatus;
  targetStatus: EnvironmentStatus;
  pythonEnvironmentRecreated: Pythonenvironmentrecreated;
  copiedComponents?: Copiedcomponents;
  warnings?: Warnings1;
}
