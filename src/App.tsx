import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { HomeScreen } from './components/HomeScreen';
import { PhotoToTextTool } from './components/PhotoToTextTool';
import { PdfSummaryTool } from './components/PdfSummaryTool';
import { AskDocumentTool } from './components/AskDocumentTool';
import { HindiTranslationTool } from './components/HindiTranslationTool';
import { AiWriterTool } from './components/AiWriterTool';
import { ScanCleanTool } from './components/ScanCleanTool';
import { PdfToolsManager } from './components/PdfToolsManager';
import { HistoryDrawer } from './components/HistoryDrawer';
import { ProModal } from './components/ProModal';
import { AuthModal } from './components/AuthModal';
import { ProfileModal } from './components/ProfileModal';
import { SettingsModal } from './components/SettingsModal';
import { AdminUsersModal } from './components/AdminUsersModal';
import { OnboardingModal } from './components/OnboardingModal';
import { AboutModal, HelpModal, PrivacyModal, TermsModal } from './components/LegalAndHelpModals';
import { ActiveTab, DocumentHistoryItem, PlanTier } from './types';
import { SAMPLE_DOCUMENTS } from './data/sampleDocuments';
import { useAuth } from './context/AuthContext';
import { apiFetch } from './utils/apiClient';
import { logger } from './utils/logger';
import { triggerHaptic } from './utils/android';

export default function App() {
  const { user, usage, isLimitReached, updatePlan, refreshUsage, getAuthHeaders } = useAuth();

  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [hasGeminiKey, setHasGeminiKey] = useState<boolean>(false);
  const [sharedText, setSharedText] = useState<string>('');

  // Modals state
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isProModalOpen, setIsProModalOpen] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isAdminUsersModalOpen, setIsAdminUsersModalOpen] = useState<boolean>(false);
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState<boolean>(() => {
    try {
      return !localStorage.getItem('ai_doc_onboarded');
    } catch {
      return false;
    }
  });
  const [isAboutModalOpen, setIsAboutModalOpen] = useState<boolean>(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState<boolean>(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState<boolean>(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState<boolean>(false);

  // PWA deferred install prompt
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      logger.info('PWA install prompt captured');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallPwa = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

  // Listen for daily AI limit reached events dispatched from apiFetch
  useEffect(() => {
    const handleQuotaReached = () => {
      setIsProModalOpen(true);
      refreshUsage();
    };
    window.addEventListener('ai_limit_reached', handleQuotaReached);
    return () => window.removeEventListener('ai_limit_reached', handleQuotaReached);
  }, [refreshUsage]);

  // Native Android hardware back button handler
  useEffect(() => {
    const handleAndroidBack = (e?: Event): boolean => {
      // 1. Close modals in order of presence
      if (isProModalOpen) {
        setIsProModalOpen(false);
        e?.preventDefault();
        return true;
      }
      if (isAuthModalOpen) {
        setIsAuthModalOpen(false);
        e?.preventDefault();
        return true;
      }
      if (isProfileModalOpen) {
        setIsProfileModalOpen(false);
        e?.preventDefault();
        return true;
      }
      if (isSettingsModalOpen) {
        setIsSettingsModalOpen(false);
        e?.preventDefault();
        return true;
      }
      if (isAdminUsersModalOpen) {
        setIsAdminUsersModalOpen(false);
        e?.preventDefault();
        return true;
      }
      if (isAboutModalOpen || isHelpModalOpen || isPrivacyModalOpen || isTermsModalOpen) {
        setIsAboutModalOpen(false);
        setIsHelpModalOpen(false);
        setIsPrivacyModalOpen(false);
        setIsTermsModalOpen(false);
        e?.preventDefault();
        return true;
      }
      if (isOnboardingModalOpen) {
        setIsOnboardingModalOpen(false);
        e?.preventDefault();
        return true;
      }
      // 2. Close history drawer
      if (isHistoryOpen) {
        setIsHistoryOpen(false);
        e?.preventDefault();
        return true;
      }
      // 3. Return to Home tab from subtool
      if (activeTab !== 'home') {
        setActiveTab('home');
        e?.preventDefault();
        return true;
      }

      // If at home with no modals, allow native Android exit
      return false;
    };

    window.onAndroidBackPressed = () => handleAndroidBack();
    window.addEventListener('androidBackButtonPressed', handleAndroidBack as any);

    return () => {
      delete window.onAndroidBackPressed;
      window.removeEventListener('androidBackButtonPressed', handleAndroidBack as any);
    };
  }, [
    isProModalOpen,
    isAuthModalOpen,
    isProfileModalOpen,
    isSettingsModalOpen,
    isAdminUsersModalOpen,
    isAboutModalOpen,
    isHelpModalOpen,
    isPrivacyModalOpen,
    isTermsModalOpen,
    isOnboardingModalOpen,
    isHistoryOpen,
    activeTab,
  ]);

  // Theme state persisted in localStorage
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('ai_doc_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore
    }
    return 'dark';
  });

  useEffect(() => {
    try {
      localStorage.setItem('ai_doc_theme', theme);
    } catch {
      // ignore
    }
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'light' ? '#ffffff' : '#0f172a');
    }
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Multi-user data isolation: separate storage keys for guest vs authenticated users
  const getStorageKey = (currentUser: typeof user) => {
    return currentUser ? `ai_doc_user_${currentUser.id}_history` : 'ai_doc_guest_history';
  };

  const [history, setHistory] = useState<DocumentHistoryItem[]>(() => {
    try {
      // Check for existing history
      const guestSaved = localStorage.getItem('ai_doc_guest_history') || localStorage.getItem('ai_doc_history');
      if (guestSaved) return JSON.parse(guestSaved);
    } catch {
      // ignore
    }
    return [
      {
        id: 'sample-hist-1',
        title: 'Rental Lease Summary',
        type: 'pdf-summary',
        category: 'Contracts & Legal',
        snippet: '11-month lease for Flat 402, Green Valley Apartments. Rent: ₹26,500/mo.',
        fullContent: SAMPLE_DOCUMENTS[0].text,
        timestamp: Date.now() - 3600000,
        isFavorite: true,
      },
    ];
  });

  // Keep user-specific local storage synchronized
  useEffect(() => {
    try {
      const key = getStorageKey(user);
      localStorage.setItem(key, JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history, user]);

  // When user signs in or signs out, switch to their isolated document set
  useEffect(() => {
    if (user) {
      // 1. Try local cache for this user
      try {
        const cached = localStorage.getItem(`ai_doc_user_${user.id}_history`);
        if (cached) {
          setHistory(JSON.parse(cached));
        }
      } catch {
        // ignore
      }

      // 2. Fetch authoritative cloud documents from backend
      apiFetch('/api/documents')
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data.documents) && data.documents.length > 0) {
            setHistory(data.documents);
          }
        })
        .catch((err) => logger.error('Failed to load user cloud documents', err));
    } else {
      // Guest session: load guest documents
      try {
        const guestSaved = localStorage.getItem('ai_doc_guest_history');
        if (guestSaved) {
          setHistory(JSON.parse(guestSaved));
        } else {
          setHistory([]);
        }
      } catch {
        setHistory([]);
      }
    }
  }, [user?.id]);

  // Check health of Gemini backend
  useEffect(() => {
    apiFetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        setHasGeminiKey(Boolean(data.hasGeminiKey));
      })
      .catch(() => {
        setHasGeminiKey(false);
      });
  }, []);

  const handleSaveHistory = async (
    title: string,
    type: ActiveTab,
    content: string,
    isFavorite: boolean = false
  ) => {
    const newItem: DocumentHistoryItem = {
      id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title,
      type,
      category: 'General',
      snippet: content.replace(/\n+/g, ' ').slice(0, 100) + '...',
      fullContent: content,
      timestamp: Date.now(),
      isFavorite,
    };

    setHistory((prev) => [newItem, ...prev.slice(0, 29)]);

    // If logged in, persist to backend database
    if (user) {
      try {
        await apiFetch('/api/documents', {
          method: 'POST',
          body: JSON.stringify(newItem),
        });
      } catch (err) {
        logger.error('Failed to save document to cloud', err);
      }
    }

    refreshUsage();
  };

  const handleToggleFavorite = async (id: string) => {
    let updatedFav = false;
    setHistory((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          updatedFav = !item.isFavorite;
          return { ...item, isFavorite: updatedFav };
        }
        return item;
      })
    );

    if (user) {
      try {
        await apiFetch(`/api/documents/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ isFavorite: updatedFav }),
        });
      } catch (err) {
        logger.error('Failed to sync favorite status to cloud', err);
      }
    }
  };

  const handleRenameItem = async (id: string, newTitle: string) => {
    setHistory((prev) =>
      prev.map((item) => (item.id === id ? { ...item, title: newTitle } : item))
    );

    if (user) {
      try {
        await apiFetch(`/api/documents/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ title: newTitle }),
        });
      } catch (err) {
        logger.error('Failed to rename document on cloud', err);
      }
    }
  };

  const handleChangeCategory = async (id: string, category: string) => {
    setHistory((prev) =>
      prev.map((item) => (item.id === id ? { ...item, category } : item))
    );

    if (user) {
      try {
        await apiFetch(`/api/documents/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ category }),
        });
      } catch (err) {
        logger.error('Failed to update category on cloud', err);
      }
    }
  };

  const handleDeleteItem = async (id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));

    if (user) {
      try {
        await apiFetch(`/api/documents/${id}`, {
          method: 'DELETE',
        });
      } catch (err) {
        logger.error('Failed to delete document on cloud', err);
      }
    }
  };

  const handleClearHistory = async () => {
    setHistory([]);
    try {
      if (user) {
        localStorage.removeItem(`ai_doc_user_${user.id}_history`);
      } else {
        localStorage.removeItem('ai_doc_guest_history');
      }
      localStorage.removeItem('ai_doc_history');
    } catch {
      // ignore
    }

    if (user) {
      apiFetch('/api/documents', { method: 'DELETE' }).catch(() => {});
    }
  };

  const handleTransferText = (text: string, targetTab: ActiveTab) => {
    setSharedText(text);
    setActiveTab(targetTab);
  };

  const handleLoadSample = (sampleId: string) => {
    const found = SAMPLE_DOCUMENTS.find((d) => d.id === sampleId);
    if (found) {
      setSharedText(found.text);
    }
  };

  const handleSelectHistoryItem = (item: DocumentHistoryItem) => {
    setSharedText(item.fullContent);
    setActiveTab(item.type);
  };

  const handleCloseOnboarding = () => {
    setIsOnboardingModalOpen(false);
    try {
      localStorage.setItem('ai_doc_onboarded', 'true');
    } catch {
      // ignore
    }
  };

  const handleClearLocalCache = () => {
    try {
      localStorage.removeItem('ai_doc_image_cache');
      if ('caches' in window) {
        caches.keys().then((names) => {
          names.forEach((name) => caches.delete(name));
        });
      }
    } catch {
      // ignore
    }
  };

  const effectivePlan: PlanTier = user?.plan || 'free';

  return (
    <div
      className={`min-h-screen ${
        theme === 'light' ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100'
      } flex flex-col antialiased selection:bg-blue-600 selection:text-white transition-colors duration-150`}
    >
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        hasGeminiKey={hasGeminiKey}
        historyCount={history.length}
        onOpenHistory={() => setIsHistoryOpen(true)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        plan={effectivePlan}
        onOpenPro={() => setIsProModalOpen(true)}
        user={user}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onOpenAdminUsers={() => setIsAdminUsersModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-3.5 sm:px-4 pt-3 sm:pt-4 pb-20 overflow-x-hidden">
        {activeTab === 'home' && (
          <HomeScreen
            onSelectTab={setActiveTab}
            recentHistory={history}
            onSelectHistory={handleSelectHistoryItem}
            onLoadSample={handleLoadSample}
            onToggleFavorite={handleToggleFavorite}
            plan={effectivePlan}
            usage={usage}
            onOpenPro={() => setIsProModalOpen(true)}
            onRenameItem={handleRenameItem}
            onDeleteItem={handleDeleteItem}
            onChangeCategory={handleChangeCategory}
          />
        )}

        {activeTab === 'scan-clean' && (
          <ScanCleanTool
            onTransferText={handleTransferText}
            onSaveHistory={handleSaveHistory}
            isLimitReached={isLimitReached}
            onOpenPro={() => setIsProModalOpen(true)}
          />
        )}

        {activeTab === 'pdf-tools' && (
          <PdfToolsManager
            onTransferText={handleTransferText}
            onSaveHistory={handleSaveHistory}
          />
        )}

        {activeTab === 'photo-to-text' && (
          <PhotoToTextTool
            initialImage={sharedText}
            onTransferText={handleTransferText}
            onSaveHistory={handleSaveHistory}
            isLimitReached={isLimitReached}
            onOpenPro={() => setIsProModalOpen(true)}
          />
        )}

        {activeTab === 'pdf-summary' && (
          <PdfSummaryTool
            initialText={sharedText}
            onTransferText={handleTransferText}
            onSaveHistory={handleSaveHistory}
            isLimitReached={isLimitReached}
            onOpenPro={() => setIsProModalOpen(true)}
          />
        )}

        {activeTab === 'ask-document' && (
          <AskDocumentTool
            initialDocumentText={sharedText}
            onTransferText={handleTransferText}
            onSaveHistory={handleSaveHistory}
            isLimitReached={isLimitReached}
            onOpenPro={() => setIsProModalOpen(true)}
          />
        )}

        {activeTab === 'hindi-translation' && (
          <HindiTranslationTool
            initialText={sharedText}
            onTransferText={handleTransferText}
            onSaveHistory={handleSaveHistory}
            isLimitReached={isLimitReached}
            onOpenPro={() => setIsProModalOpen(true)}
          />
        )}

        {activeTab === 'ai-writer' && (
          <AiWriterTool
            initialText={sharedText}
            onTransferText={handleTransferText}
            onSaveHistory={handleSaveHistory}
            isLimitReached={isLimitReached}
            onOpenPro={() => setIsProModalOpen(true)}
          />
        )}
      </main>

      {/* Thumb-Friendly Bottom Navigation Bar */}
      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* History Slide Drawer with Search, Folders, and Renaming */}
      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onSelect={handleSelectHistoryItem}
        onClear={handleClearHistory}
        onToggleFavorite={handleToggleFavorite}
        onRenameItem={handleRenameItem}
        onChangeCategory={handleChangeCategory}
        onDeleteItem={handleDeleteItem}
      />

      {/* Pro Tier & Upgrade Modal */}
      <ProModal
        isOpen={isProModalOpen}
        onClose={() => setIsProModalOpen(false)}
        plan={effectivePlan}
        isLimitReached={isLimitReached}
        onUpgrade={() => updatePlan('pro')}
        onDowngrade={() => updatePlan('free')}
        onOpenAdminUsers={() => setIsAdminUsersModalOpen(true)}
      />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* User Profile Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        onOpenPro={() => setIsProModalOpen(true)}
        onOpenAdminUsers={() => setIsAdminUsersModalOpen(true)}
      />

      {/* Owner / Admin User Management Modal */}
      <AdminUsersModal
        isOpen={isAdminUsersModalOpen}
        onClose={() => setIsAdminUsersModalOpen(false)}
      />

      {/* App Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        historyCount={history.length}
        onClearLocalCache={handleClearLocalCache}
        onOpenAbout={() => setIsAboutModalOpen(true)}
        onOpenHelp={() => setIsHelpModalOpen(true)}
        onOpenPrivacy={() => setIsPrivacyModalOpen(true)}
        onOpenTerms={() => setIsTermsModalOpen(true)}
        onOpenOnboarding={() => setIsOnboardingModalOpen(true)}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onOpenAdminUsers={() => setIsAdminUsersModalOpen(true)}
        installPrompt={deferredPrompt}
        onInstallPwa={handleInstallPwa}
      />

      {/* Onboarding Feature Tour Modal */}
      <OnboardingModal
        isOpen={isOnboardingModalOpen}
        onClose={handleCloseOnboarding}
      />

      {/* Informational & Legal Modals */}
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />

      <HelpModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
      />

      <PrivacyModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />

      <TermsModal
        isOpen={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
      />
    </div>
  );
}
