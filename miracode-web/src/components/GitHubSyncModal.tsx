import React, { useState, useEffect } from 'react';
import { X, FolderGit2, Check, ExternalLink, RefreshCw, Key, Plus, Lock, Globe, Download, ShieldCheck, AlertCircle } from 'lucide-react';
import { GitHubRepository } from '../types/github';
import { githubService } from '../services/githubService';

interface GitHubSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCode: string;
  projectName: string;
  savedToken: string;
  onSaveToken: (token: string) => void;
}

export const GitHubSyncModal: React.FC<GitHubSyncModalProps> = ({
  isOpen,
  onClose,
  activeCode,
  projectName,
  savedToken,
  onSaveToken,
}) => {
  const [token, setToken] = useState(savedToken);
  const [username, setUsername] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [repos, setRepos] = useState<GitHubRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [isPushing, setIsPushing] = useState(false);
  const [commitMessage, setCommitMessage] = useState('Update via AetherCode iOS (iPhone 17 Pro Max Local AI)');
  const [pushResult, setPushResult] = useState<{ success: boolean; url?: string; error?: string } | null>(null);

  // New repo state
  const [showNewRepo, setShowNewRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState(projectName.toLowerCase().replace(/\s+/g, '-'));
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);

  useEffect(() => {
    if (savedToken) {
      setToken(savedToken);
      validateAndFetch(savedToken);
    }
  }, [savedToken]);

  if (!isOpen) return null;

  const validateAndFetch = async (t: string) => {
    if (!t.trim()) return;
    setIsValidating(true);
    setTokenError('');
    const res = await githubService.validateToken(t);
    setIsValidating(false);

    if (res.valid) {
      setUsername(res.username);
      onSaveToken(t.trim());
      // Fetch user repos
      const repoList = await githubService.listRepositories(t);
      setRepos(repoList);
      if (repoList.length > 0 && !selectedRepo) {
        setSelectedRepo(repoList[0].full_name);
      }
    } else {
      setTokenError(res.error || 'Invalid token');
    }
  };

  const handleCreateRepo = async () => {
    if (!token.trim() || !newRepoName.trim()) return;
    setIsCreatingRepo(true);
    const res = await githubService.createRepository(token, newRepoName, 'Built with AetherCode iOS', newRepoPrivate);
    setIsCreatingRepo(false);

    if (res.success && res.repo) {
      setRepos([res.repo, ...repos]);
      setSelectedRepo(res.repo.full_name);
      setShowNewRepo(false);
    } else {
      setTokenError(res.error || 'Failed to create repo');
    }
  };

  const handlePush = async () => {
    if (!selectedRepo || !token) return;
    setIsPushing(true);
    setPushResult(null);

    const [owner, repo] = selectedRepo.split('/');
    const files = [
      { path: 'src/App.tsx', content: activeCode },
      {
        path: 'src/main.tsx',
        content: `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.tsx';\nimport './index.css';\n\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);`,
      },
      {
        path: 'README.md',
        content: `# ${projectName}\n\nGenerated with AetherCode iOS on iPhone 17 Pro Max using on-device Apple Intelligence Local AI.\n\n### Tech Stack\n- React 19 + TypeScript\n- Tailwind CSS\n- Lucide React\n`,
      },
    ];

    const result = await githubService.pushFiles(token, owner, repo, 'main', files, commitMessage);
    setIsPushing(false);

    if (result.success) {
      setPushResult({ success: true, url: result.commitUrl });
    } else {
      setPushResult({ success: false, error: result.error });
    }
  };

  const handleDownloadZip = async () => {
    await githubService.exportProjectZip(projectName, activeCode);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md p-0 sm:p-4">
      <div className="w-full max-w-xl max-h-[88dvh] bg-zinc-900 border border-zinc-800 rounded-t-[32px] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden pb-safe">
        {/* Grab Handle */}
        <div className="w-12 h-1.5 bg-zinc-700 rounded-full mx-auto my-3 sm:hidden" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-cyan-400">
              <FolderGit2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">GitHub Sync & Export</h2>
              <p className="text-xs text-zinc-400">Secure client-side push & offline ZIP download</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* GitHub Personal Access Token Section */}
          <div className="p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-cyan-400" />
                <span>Personal Access Token (PAT)</span>
              </label>
              {username && (
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> @{username}
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="flex-1 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500"
              />
              <button
                onClick={() => validateAndFetch(token)}
                disabled={isValidating || !token.trim()}
                className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-zinc-200 transition active:scale-95 flex items-center gap-1"
              >
                {isValidating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Connect'}
              </button>
            </div>

            {tokenError && (
              <p className="text-[11px] text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {tokenError}
              </p>
            )}

            <p className="text-[11px] text-zinc-500">
              Generate a classic token on GitHub with <code className="text-zinc-400">repo</code> scope. Token stays on your iPhone inside encrypted IndexedDB.
            </p>
          </div>

          {/* Repository Selection & Commit */}
          {username && (
            <div className="p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-200">
                  Target Repository
                </label>
                <button
                  onClick={() => setShowNewRepo(!showNewRepo)}
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showNewRepo ? 'Cancel' : 'New Repo'}</span>
                </button>
              </div>

              {showNewRepo ? (
                <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
                  <input
                    type="text"
                    value={newRepoName}
                    onChange={e => setNewRepoName(e.target.value)}
                    placeholder="repository-name"
                    className="w-full px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-200"
                  />
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newRepoPrivate}
                        onChange={e => setNewRepoPrivate(e.target.checked)}
                        className="rounded"
                      />
                      <span>Private Repository</span>
                    </label>
                    <button
                      onClick={handleCreateRepo}
                      disabled={isCreatingRepo}
                      className="px-3 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold text-xs"
                    >
                      {isCreatingRepo ? 'Creating...' : 'Create & Select'}
                    </button>
                  </div>
                </div>
              ) : (
                <select
                  value={selectedRepo}
                  onChange={e => setSelectedRepo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
                >
                  {repos.map(r => (
                    <option key={r.id} value={r.full_name}>
                      {r.full_name} {r.private ? '🔒' : '🌐'}
                    </option>
                  ))}
                </select>
              )}

              {/* Commit Message */}
              <div>
                <label className="text-xs font-semibold text-zinc-400 block mb-1">
                  Commit Summary
                </label>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={e => setCommitMessage(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Push Action Button */}
              <button
                onClick={handlePush}
                disabled={isPushing || !selectedRepo}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 text-white font-medium text-xs shadow-md shadow-cyan-500/20 active:scale-95 transition flex items-center justify-center gap-2"
              >
                {isPushing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Syncing files to GitHub...</span>
                  </>
                ) : (
                  <>
                    <FolderGit2 className="w-3.5 h-3.5" />
                    <span>Push to {selectedRepo || 'Repository'}</span>
                  </>
                )}
              </button>

              {/* Push Result Banner */}
              {pushResult && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center justify-between ${
                    pushResult.success
                      ? 'bg-emerald-950/40 border border-emerald-800/60 text-emerald-300'
                      : 'bg-rose-950/40 border border-rose-800/60 text-rose-300'
                  }`}
                >
                  <span>{pushResult.success ? 'Successfully pushed to GitHub!' : pushResult.error}</span>
                  {pushResult.url && (
                    <a
                      href={pushResult.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 font-semibold underline text-emerald-400"
                    >
                      <span>View Commit</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Direct Offline ZIP Download Option */}
          <div className="p-4 rounded-2xl bg-zinc-950/40 border border-zinc-800 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-zinc-200">Offline ZIP Archive Export</h3>
              <p className="text-[11px] text-zinc-500 mt-0.5">Download complete runnable project files directly to your iPhone</p>
            </div>
            <button
              onClick={handleDownloadZip}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition active:scale-95 flex items-center gap-1.5 shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export ZIP</span>
            </button>
          </div>
        </div>

        {/* Security Footnote */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/80 flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <span>Zero server intermediary — direct browser-to-GitHub API</span>
          </div>
          <button onClick={onClose} className="hover:text-zinc-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
