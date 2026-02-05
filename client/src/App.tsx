/**
 * Main App Component
 * Chat interface layout with routing
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from './stores/authStore';
import { useChatStore } from './stores/chatStore';
import { useEncryptionStore } from './stores/encryptionStore';
import { getEncryptionKey } from './services/api';
import { Sidebar } from './components/Sidebar/Sidebar';
import { MessageList } from './components/Chat/MessageList';
import { ChatInput } from './components/Chat/ChatInput';
import { ModelSelector } from './components/Chat/ModelSelector';
import { LoginForm } from './components/Auth/LoginForm';
import { OAuthCallback } from './components/Auth/OAuthCallback';
import { EncryptionUnlockModal } from './components/Auth/EncryptionUnlockModal';
import { SettingsModal } from './components/Settings/SettingsModal';
import { ImportExportModal } from './components/Settings/ImportExportModal';
import { Menu, AlertCircle } from 'lucide-react';

function ChatLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const { error, clearError } = useChatStore();
  
  return (
    <div className="flex h-screen bg-white dark:bg-gray-800">
      {/* Sidebar */}
      <Sidebar 
        isOpen={sidebarOpen} 
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={settingsOpen} 
        onClose={() => setSettingsOpen(false)}
        onOpenImportExport={() => {
          setSettingsOpen(false);
          setImportExportOpen(true);
        }}
      />
      
      {/* Import/Export Modal */}
      <ImportExportModal isOpen={importExportOpen} onClose={() => setImportExportOpen(false)} />
      
      {/* Main chat area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-4">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg hidden lg:block"
              >
                <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            )}
            <ModelSelector />
          </div>
        </header>
        
        {/* Error banner */}
        {error && (
          <div className="px-4 py-3 bg-red-100 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
            <button
              onClick={clearError}
              className="text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm"
            >
              Dismiss
            </button>
          </div>
        )}
        
        {/* Messages */}
        <MessageList />
        
        {/* Input */}
        <ChatInput />
      </main>
    </div>
  );
}

function Router() {
  const path = window.location.pathname;
  
  // Handle OAuth callback
  if (path === '/auth/callback') {
    return <OAuthCallback />;
  }
  
  // Default: show login or chat
  return null;
}

function App() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const { isEncryptionEnabled } = useEncryptionStore();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [showEncryptionModal, setShowEncryptionModal] = useState(false);
  const [encryptionChecked, setEncryptionChecked] = useState(false);
  const [skippedEncryption, setSkippedEncryption] = useState(false);
  
  useEffect(() => {
    checkAuth();
    
    // Listen for navigation
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [checkAuth]);

  // Check if encryption key exists when user is authenticated
  useEffect(() => {
    const checkEncryption = async () => {
      if (isAuthenticated && !encryptionChecked && !isLoading) {
        try {
          const keyData = await getEncryptionKey();
          if (keyData.exists && !isEncryptionEnabled && !skippedEncryption) {
            setShowEncryptionModal(true);
          }
        } catch {
          // Ignore errors - encryption is optional
        } finally {
          setEncryptionChecked(true);
        }
      }
    };
    
    checkEncryption();
  }, [isAuthenticated, encryptionChecked, isLoading, isEncryptionEnabled, skippedEncryption]);

  // Reset encryption check state when user logs out
  useEffect(() => {
    if (!isAuthenticated) {
      setEncryptionChecked(false);
      setSkippedEncryption(false);
      setShowEncryptionModal(false);
    }
  }, [isAuthenticated]);

  const handleEncryptionUnlocked = useCallback(() => {
    setShowEncryptionModal(false);
  }, []);

  const handleEncryptionSkipped = useCallback(() => {
    setShowEncryptionModal(false);
    setSkippedEncryption(true);
  }, []);

  // Handle OAuth callback route
  if (currentPath === '/auth/callback') {
    return <OAuthCallback />;
  }
  
  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }
  
  // Auth check
  if (!isAuthenticated) {
    return <LoginForm />;
  }
  
  return (
    <>
      <ChatLayout />
      <EncryptionUnlockModal
        isOpen={showEncryptionModal}
        onUnlocked={handleEncryptionUnlocked}
        onSkip={handleEncryptionSkipped}
      />
    </>
  );
}

export default App;
