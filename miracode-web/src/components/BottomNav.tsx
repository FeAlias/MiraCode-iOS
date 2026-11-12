import React from 'react';
import { Sparkles, Eye, Code, History, GitFork } from 'lucide-react';

export type TabType = 'prompt' | 'preview' | 'code' | 'history' | 'sync';

interface BottomNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  versionCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onTabChange,
  versionCount,
}) => {
  const tabs = [
    { id: 'prompt' as TabType, label: 'Prompt', icon: Sparkles },
    { id: 'preview' as TabType, label: 'Preview', icon: Eye },
    { id: 'code' as TabType, label: 'Code', icon: Code },
    { id: 'history' as TabType, label: 'Versions', icon: History, badge: versionCount },
    { id: 'sync' as TabType, label: 'GitHub', icon: GitFork },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/90 backdrop-blur-2xl border-t border-zinc-800/80 pb-safe">
      <div className="max-w-md mx-auto grid grid-cols-5 h-16 items-center px-2">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center min-h-[44px] min-w-[44px] relative transition-transform active:scale-95 ${
                isActive ? 'text-cyan-400' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute -top-1 -right-2.5 px-1 min-w-[14px] h-[14px] rounded-full bg-zinc-800 border border-zinc-700 text-[9px] font-mono text-zinc-300 flex items-center justify-center">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-medium tracking-tight mt-1 ${isActive ? 'font-semibold' : ''}`}>
                {tab.label}
              </span>
              {isActive && (
                <span className="w-1 h-1 rounded-full bg-cyan-400 mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
