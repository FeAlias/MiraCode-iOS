export type AIModelType =
  | 'native_metal'
  | 'apple_intelligence'
  | 'webllm_local'
  | 'ollama_local'
  | 'gemini_cloud';

export type IOSMemoryTier = 'safe' | 'moderate' | 'heavy';

export interface ShardDownloadStatus {
  cachedShards: number;
  totalShards: number;
  completedParts: number;
  totalParts: number;
  isComplete: boolean;
}

export interface LocalAIModel {
  id: string;
  webllmModelId?: string;
  name: string;
  provider: 'metal' | 'apple' | 'webllm' | 'ollama' | 'cloud';
  type: AIModelType;
  description: string;
  parameters: string;
  sizeOnDisk: string;
  vramMB?: number;
  iosMemoryTier?: IOSMemoryTier;
  isAvailableOffline: boolean;
  isDownloaded: boolean;
  isLoadedInVRAM?: boolean;
  downloadProgress?: number; // 0-100
  cachedShards?: number;
  totalShards?: number;
  completedParts?: number;
  totalParts?: number;
  recommendedDevice: string;
  contextWindow: number;
}

export interface CrashRecoveryInfo {
  modelId: string;
  modelName: string;
  phase: string;
  timestamp: number;
}

export interface WebGPUStatus {
  supported: boolean;
  isIOS: boolean;
  maxBufferMB: number;
  details: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  chunks: string[];
  sizeBytes: number;
  enabled: boolean;
  createdAt: number;
}

export type AgentInteractionMode = 'auto' | 'chat' | 'plan' | 'build';

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface PlanStepItem {
  id: string;
  stepNumber: number;
  title: string;
  details: string;
  status: PlanStepStatus;
  errorNote?: string;
}

export interface AgentCodingPlan {
  id: string;
  goal: string;
  summary: string;
  steps: PlanStepItem[];
  isNewAppFromScratch?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PlanStepExecutionContext {
  goal: string;
  stepNumber: number;
  totalSteps: number;
  stepTitle: string;
  stepDetails: string;
  completedStepTitles: string[];
  forceFreshStart?: boolean;
}

export interface PromptGenerationRequest {
  prompt: string;
  systemPrompt?: string;
  currentCode: string;
  modelId: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  temperature?: number;
  lastRuntimeError?: string | null;
  docContext?: string;
  planStepContext?: PlanStepExecutionContext;
}

export interface GenerationResult {
  code: string;
  explanation: string;
  versionTitle: string;
  modelUsed: string;
  tokensUsed?: number;
  durationMs: number;
  selfFixedRuntime?: boolean;
}
