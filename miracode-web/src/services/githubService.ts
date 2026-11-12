import JSZip from 'jszip';
import { GitHubConfig, GitHubRepository, GitHubCommitResult } from '../types/github';

export class GitHubService {
  private config: GitHubConfig = {
    token: '',
    username: '',
    defaultBranch: 'main',
  };

  setConfig(config: GitHubConfig) {
    this.config = config;
  }

  getConfig(): GitHubConfig {
    return this.config;
  }

  // Validate GitHub Token & Get User Profile
  async validateToken(token: string): Promise<{ valid: boolean; username: string; error?: string }> {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${token.trim()}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!res.ok) {
        if (res.status === 401) throw new Error('Invalid or expired Personal Access Token');
        throw new Error(`GitHub API error (${res.status})`);
      }

      const user = await res.json();
      return { valid: true, username: user.login };
    } catch (e: any) {
      return { valid: false, username: '', error: e.message };
    }
  }

  // Fetch repositories
  async listRepositories(token: string): Promise<GitHubRepository[]> {
    try {
      const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=30', {
        headers: {
          Authorization: `token ${token.trim()}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!res.ok) throw new Error('Failed to fetch repositories');
      const data = await res.json();
      return data.map((r: any) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        html_url: r.html_url,
        description: r.description,
        default_branch: r.default_branch || 'main',
      }));
    } catch (e) {
      console.warn('GitHub list repos error:', e);
      return [];
    }
  }

  // Create a new GitHub repository
  async createRepository(
    token: string,
    name: string,
    description: string,
    isPrivate: boolean
  ): Promise<{ success: boolean; repo?: GitHubRepository; error?: string }> {
    try {
      const res = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `token ${token.trim()}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim().replace(/\s+/g, '-'),
          description: description || 'Generated with AetherCode iOS (iPhone 17 Pro Max Local AI)',
          private: isPrivate,
          auto_init: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to create repository');
      }

      const r = await res.json();
      return {
        success: true,
        repo: {
          id: r.id,
          name: r.name,
          full_name: r.full_name,
          private: r.private,
          html_url: r.html_url,
          description: r.description,
          default_branch: r.default_branch || 'main',
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // Commit and Push files to GitHub repository
  async pushFiles(
    token: string,
    owner: string,
    repo: string,
    branch: string,
    files: { path: string; content: string }[],
    commitMessage: string
  ): Promise<GitHubCommitResult> {
    try {
      let lastCommitUrl = '';
      let lastSha = '';

      for (const file of files) {
        // First check if file exists to retrieve current sha
        const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`;
        let existingSha: string | undefined;

        try {
          const checkRes = await fetch(getUrl, {
            headers: {
              Authorization: `token ${token.trim()}`,
              Accept: 'application/vnd.github.v3+json',
            },
          });
          if (checkRes.ok) {
            const fileData = await checkRes.json();
            existingSha = fileData.sha;
          }
        } catch {
          // New file
        }

        // Base64 encode content UTF-8 safely
        const base64Content = btoa(unescape(encodeURIComponent(file.content)));

        const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`;
        const putRes = await fetch(putUrl, {
          method: 'PUT',
          headers: {
            Authorization: `token ${token.trim()}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: commitMessage,
            content: base64Content,
            branch: branch,
            sha: existingSha,
          }),
        });

        if (!putRes.ok) {
          const err = await putRes.json();
          throw new Error(`Failed to commit ${file.path}: ${err.message || putRes.statusText}`);
        }

        const resData = await putRes.json();
        lastCommitUrl = resData.commit?.html_url || `https://github.com/${owner}/${repo}`;
        lastSha = resData.commit?.sha || '';
      }

      return {
        success: true,
        commitSha: lastSha,
        commitUrl: lastCommitUrl,
      };
    } catch (e: any) {
      return {
        success: false,
        error: e.message,
      };
    }
  }

  // Offline ZIP Exporter
  async exportProjectZip(projectName: string, activeCode: string): Promise<void> {
    const zip = new JSZip();

    // Add source code
    zip.file('src/App.tsx', activeCode);
    
    // Add main entry
    zip.file(
      'src/main.tsx',
      `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);`
    );

    zip.file('src/index.css', `@import "tailwindcss";`);

    // Add index.html
    zip.file(
      'index.html',
      `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`
    );

    // Add package.json
    zip.file(
      'package.json',
      JSON.stringify(
        {
          name: projectName.toLowerCase().replace(/\s+/g, '-'),
          private: true,
          version: '1.0.0',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'vite build',
            preview: 'vite preview',
          },
          dependencies: {
            react: '^19.0.0',
            'react-dom': '^19.0.0',
            'lucide-react': '^0.546.0',
          },
          devDependencies: {
            '@tailwindcss/vite': '^4.0.0',
            '@vitejs/plugin-react': '^4.3.0',
            tailwindcss: '^4.0.0',
            typescript: '^5.7.0',
            vite: '^6.0.0',
          },
        },
        null,
        2
      )
    );

    // Add README.md
    zip.file(
      'README.md',
      `# ${projectName}

Crafted on iPhone 17 Pro Max using **AetherCode iOS** (Offline Local AI Studio).

## Stack
- React 19 + TypeScript
- Tailwind CSS
- Lucide React Icons
- Apple Intelligence / Local AI on-device inference

## Run Locally
\`\`\`bash
npm install
npm run dev
\`\`\`
`
    );

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.toLowerCase().replace(/\s+/g, '-')}-source.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const githubService = new GitHubService();
