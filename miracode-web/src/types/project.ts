export interface VersionSnapshot {
  id: string;
  versionNumber: number;
  versionTag: string; // e.g., 'v1.0', 'v1.1'
  timestamp: number;
  title: string;
  summary: string;
  code: string;
  modelUsed?: string;
  prompt?: string;
  linesAdded: number;
  linesRemoved: number;
  trigger: 'prompt' | 'manual' | 'restore';
}

export interface ProjectChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ProjectFile {
  name: string;
  path: string;
  content: string;
  language: 'typescript' | 'html' | 'css' | 'json';
}

export interface CodeProject {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  activeCode: string;
  versions: VersionSnapshot[];
  messages?: ProjectChatMessage[];
  files: Record<string, string>;
  githubRepo?: {
    owner: string;
    repo: string;
    branch: string;
    lastSyncedAt?: number;
    lastCommitSha?: string;
  };
}

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}
