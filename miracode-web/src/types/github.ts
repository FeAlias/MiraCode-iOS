export interface GitHubConfig {
  token: string;
  username: string;
  defaultBranch: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
}

export interface GitHubCommitResult {
  success: boolean;
  commitSha?: string;
  commitUrl?: string;
  error?: string;
}
