import React from 'react';
import {
  Camera,
  FileSearch,
  MessageSquareQuote,
  Languages,
  PenTool,
  Home,
  Scan,
  Files,
} from 'lucide-react';
import { ActiveTab } from '../types';

interface BottomNavProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
}

interface NavItem {
  id: ActiveTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'scan-clean', label: 'Scan', icon: Scan },
  { id: 'pdf-tools', label: 'PDF Tools', icon: Files },
  { id: 'photo-to-text', label: 'OCR', icon: Camera },
  { id: 'pdf-summary', label: 'Summary', icon: FileSearch },
  { id: 'ask-document', label: 'Ask Doc', icon: MessageSquareQuote },
  { id: 'hindi-translation', label: 'Translate', icon: Languages },
  { id: 'ai-writer', label: 'Writer', icon: PenTool },
];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, setActiveTab }) => {
  return (
    <nav
      id="bottom-navigation-bar"
      className="fixed bottom-0 left-0 right-0 z-30 bg-slate-900/95 backdrop-blur border-t border-slate-800 pb-safe"
    >
      <div className="max-w-2xl mx-auto flex items-center overflow-x-auto no-scrollbar h-15 px-1 sm:px-2 gap-1 sm:justify-around">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              id={`nav-btn-${item.id}`}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center min-w-[56px] sm:flex-1 py-1 px-1 transition-all duration-150 relative shrink-0 ${
                isActive
                  ? 'text-blue-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isActive && (
                <span className="absolute -top-[1px] w-6 h-[2px] bg-blue-500 rounded-full" />
              )}
              <div
                className={`p-1 rounded-lg transition-transform ${
                  isActive ? 'bg-blue-500/10 scale-105' : ''
                }`}
              >
                <Icon className="w-4.5 h-4.5" />
              </div>
              <span className="text-[10px] tracking-tight leading-tight mt-0.5 truncate whitespace-nowrap">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
