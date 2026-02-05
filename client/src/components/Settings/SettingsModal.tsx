/**
 * Settings Modal Component
 * User profile settings, API keys, and preferences
 */

import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import {
  X,
  User,
  Key,
  Shield,
  Database,
  Loader2,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Trash2,
  Brain,
  Search,
  Plus,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenImportExport?: () => void;
}

type TabId = 'profile' | 'apikeys' | 'security' | 'memory' | 'data';

interface TabItem {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const tabs: TabItem[] = [
  { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
  { id: 'apikeys', label: 'API Keys', icon: <Key className="w-4 h-4" /> },
  { id: 'security', label: 'Security', icon: <Shield className="w-4 h-4" /> },
  { id: 'memory', label: 'Memory', icon: <Brain className="w-4 h-4" /> },
  { id: 'data', label: 'Data', icon: <Database className="w-4 h-4" /> },
];

export function SettingsModal({ isOpen, onClose, onOpenImportExport }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex h-[500px]">
          {/* Sidebar */}
          <nav className="w-48 border-r border-gray-200 dark:border-gray-700 p-4 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'profile' && <ProfileTab />}
            {activeTab === 'apikeys' && <ApiKeysTab />}
            {activeTab === 'security' && <SecurityTab />}
            {activeTab === 'memory' && <MemoryTab />}
            {activeTab === 'data' && <DataTab onOpenImportExport={onOpenImportExport} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileTab() {
  const { user, updateProfile } = useAuthStore();
  const [name, setName] = useState(user?.name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      await updateProfile({ name, username });
      setMessage({ type: 'success', text: 'Profile updated successfully' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to update profile' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
        Profile Information
      </h3>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
          }`}
        >
          {message.type === 'success' ? (
            <Check className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Email
          </label>
          <input
            type="email"
            value={user?.email || ''}
            disabled
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
          />
          <p className="mt-1 text-xs text-gray-500">Email cannot be changed</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
            placeholder="Your name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
            placeholder="username"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Changes
        </button>
      </form>
    </div>
  );
}

function ApiKeysTab() {
  const [keys, setKeys] = useState({
    openai: '',
    anthropic: '',
    google: '',
  });
  const [showKeys, setShowKeys] = useState({
    openai: false,
    anthropic: false,
    google: false,
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load keys from localStorage
  useEffect(() => {
    const savedKeys = localStorage.getItem('apiKeys');
    if (savedKeys) {
      try {
        setKeys(JSON.parse(savedKeys));
      } catch {}
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('apiKeys', JSON.stringify(keys));
    setMessage({ type: 'success', text: 'API keys saved locally' });
    setTimeout(() => setMessage(null), 3000);
  };

  const toggleVisibility = (key: keyof typeof showKeys) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
        API Keys
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Enter your own API keys to use with L_EXE. Keys are stored locally in your browser.
      </p>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
          }`}
        >
          {message.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      <div className="space-y-4">
        {/* OpenAI */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            OpenAI API Key
          </label>
          <div className="relative">
            <input
              type={showKeys.openai ? 'text' : 'password'}
              value={keys.openai}
              onChange={(e) => setKeys((prev) => ({ ...prev, openai: e.target.value }))}
              className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              placeholder="sk-..."
            />
            <button
              type="button"
              onClick={() => toggleVisibility('openai')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
            >
              {showKeys.openai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Anthropic */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Anthropic API Key
          </label>
          <div className="relative">
            <input
              type={showKeys.anthropic ? 'text' : 'password'}
              value={keys.anthropic}
              onChange={(e) => setKeys((prev) => ({ ...prev, anthropic: e.target.value }))}
              className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              placeholder="sk-ant-..."
            />
            <button
              type="button"
              onClick={() => toggleVisibility('anthropic')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
            >
              {showKeys.anthropic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Google */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Google AI API Key
          </label>
          <div className="relative">
            <input
              type={showKeys.google ? 'text' : 'password'}
              value={keys.google}
              onChange={(e) => setKeys((prev) => ({ ...prev, google: e.target.value }))}
              className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              placeholder="AIza..."
            />
            <button
              type="button"
              onClick={() => toggleVisibility('google')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
            >
              {showKeys.google ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
        >
          Save API Keys
        </button>
      </div>
    </div>
  );
}

function SecurityTab() {
  const { changePassword, deleteAccount, user } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Check if user is OAuth user (no password)
  const isOAuthUser = user?.provider && user.provider !== 'local';

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }

    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      await changePassword({ currentPassword, newPassword });
      setMessage({ type: 'success', text: 'Password updated successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to update password' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!isOAuthUser && !deletePassword) {
      setMessage({ type: 'error', text: 'Please enter your password to confirm deletion' });
      return;
    }

    setIsDeleting(true);
    try {
      await deleteAccount(deletePassword);
      // Redirect happens automatically in the store
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to delete account' });
      setIsDeleting(false);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
        Change Password
      </h3>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
          }`}
        >
          {message.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {isOAuthUser ? (
        <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            You signed in with {user?.provider}. Password management is not available for OAuth accounts.
          </p>
        </div>
      ) : (
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Current Password
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              New Password
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              required
              minLength={8}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Confirm New Password
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              required
              minLength={8}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(e) => setShowPasswords(e.target.checked)}
              className="rounded"
            />
            Show passwords
          </label>

          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            Update Password
          </button>
        </form>
      )}

      {/* Danger Zone */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-medium text-red-600 dark:text-red-400 mb-2">
          Danger Zone
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Once you delete your account, there is no going back. Please be certain.
        </p>

        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 border border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete Account
          </button>
        ) : (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg space-y-4">
            <p className="text-sm text-red-600 dark:text-red-400">
              Are you sure you want to delete your account? This action cannot be undone.
              All your conversations, messages, and data will be permanently deleted.
            </p>
            
            {!isOAuthUser && (
              <div>
                <label className="block text-sm font-medium text-red-700 dark:text-red-400 mb-1">
                  Enter your password to confirm
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="w-full px-3 py-2 border border-red-300 dark:border-red-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
                  placeholder="Enter your password"
                />
              </div>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={handleDeleteAccount}
                disabled={isDeleting || (!isOAuthUser && !deletePassword)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                Yes, Delete My Account
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeletePassword('');
                }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Memory types for display
interface Memory {
  id: string;
  type: 'fact' | 'preference' | 'project' | 'instruction' | 'custom';
  key: string;
  value: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
}

const memoryTypeLabels: Record<string, { label: string; color: string }> = {
  fact: { label: 'Fact', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  preference: { label: 'Preference', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  project: { label: 'Project', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  instruction: { label: 'Instruction', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  custom: { label: 'Custom', color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
};

// Profile fields that are stored as special memories
const PROFILE_KEYS = {
  nickname: 'profile_nickname',
  occupation: 'profile_occupation',
  location: 'profile_location',
  about: 'profile_about',
  instructions: 'profile_custom_instructions',
};

interface UserProfile {
  nickname: string;
  occupation: string;
  location: string;
  about: string;
  instructions: string;
}

function MemoryTab() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMemory, setNewMemory] = useState({ type: 'custom', key: '', value: '' });
  const [isAdding, setIsAdding] = useState(false);
  
  // Profile state
  const [profile, setProfile] = useState<UserProfile>({
    nickname: '',
    occupation: '',
    location: '',
    about: '',
    instructions: '',
  });
  const [profileSaving, setProfileSaving] = useState<string | null>(null);
  const [profileDirty, setProfileDirty] = useState<Set<string>>(new Set());
  const [showProfile, setShowProfile] = useState(true);

  // API base URL for production vs development
  const getApiBase = () => {
    if (typeof window !== 'undefined' && window.location.hostname.includes('pages.dev')) {
      return 'https://l-exe.datasloth.workers.dev/api';
    }
    return '/api';
  };

  // Fetch memories on mount
  useEffect(() => {
    fetchMemories();
  }, []);
  
  // Extract profile from memories when loaded
  useEffect(() => {
    const newProfile: UserProfile = {
      nickname: '',
      occupation: '',
      location: '',
      about: '',
      instructions: '',
    };
    
    for (const memory of memories) {
      if (memory.key === PROFILE_KEYS.nickname) newProfile.nickname = memory.value;
      if (memory.key === PROFILE_KEYS.occupation) newProfile.occupation = memory.value;
      if (memory.key === PROFILE_KEYS.location) newProfile.location = memory.value;
      if (memory.key === PROFILE_KEYS.about) newProfile.about = memory.value;
      if (memory.key === PROFILE_KEYS.instructions) newProfile.instructions = memory.value;
    }
    
    setProfile(newProfile);
    setProfileDirty(new Set());
  }, [memories]);

  const fetchMemories = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/memory`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch memories');
      const data = await res.json();
      setMemories(data.memories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    } finally {
      setIsLoading(false);
    }
  };

  const deleteMemory = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`${getApiBase()}/memory/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete memory');
      setMemories(memories.filter(m => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const deleteAllMemories = async () => {
    if (!confirm('Are you sure you want to delete ALL memories? This cannot be undone.')) return;
    
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/memory?confirm=true`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete memories');
      setMemories([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setIsLoading(false);
    }
  };

  const addMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemory.value.trim()) return;

    setIsAdding(true);
    try {
      const res = await fetch(`${getApiBase()}/memory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          type: newMemory.type,
          key: newMemory.key || `${newMemory.type}_${Date.now()}`,
          value: newMemory.value,
        }),
      });
      if (!res.ok) throw new Error('Failed to add memory');
      const created = await res.json();
      setMemories([created, ...memories]);
      setNewMemory({ type: 'custom', key: '', value: '' });
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add memory');
    } finally {
      setIsAdding(false);
    }
  };

  // Save a profile field
  const saveProfileField = async (field: keyof UserProfile, key: string, type: string) => {
    const value = profile[field].trim();
    if (!value) {
      // If empty, delete the memory if it exists
      const existing = memories.find(m => m.key === key);
      if (existing) {
        await deleteMemory(existing.id);
      }
      setProfileDirty(prev => { const next = new Set(prev); next.delete(field); return next; });
      return;
    }

    setProfileSaving(field);
    try {
      const res = await fetch(`${getApiBase()}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type,
          key,
          value,
          importance: 1.0, // High importance for profile info
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const created = await res.json();
      
      // Update memories list (replace if exists, add if new)
      setMemories(prev => {
        const existing = prev.findIndex(m => m.key === key);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = created;
          return updated;
        }
        return [created, ...prev];
      });
      
      setProfileDirty(prev => { const next = new Set(prev); next.delete(field); return next; });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setProfileSaving(null);
    }
  };

  // Handle profile field change
  const handleProfileChange = (field: keyof UserProfile, value: string) => {
    setProfile(prev => ({ ...prev, [field]: value }));
    setProfileDirty(prev => new Set(prev).add(field));
  };

  // Filter memories (exclude profile keys from the list)
  const profileKeyValues = Object.values(PROFILE_KEYS);
  const filteredMemories = memories.filter(m => {
    // Exclude profile memories from the general list
    if (profileKeyValues.includes(m.key)) return false;
    const matchesType = filterType === 'all' || m.type === filterType;
    const matchesSearch = !searchQuery || 
      m.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.key.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  // Helper to render a profile input field
  const ProfileField = ({ 
    label, 
    field, 
    memoryKey, 
    type, 
    placeholder,
    multiline = false 
  }: { 
    label: string; 
    field: keyof UserProfile; 
    memoryKey: string; 
    type: string;
    placeholder: string;
    multiline?: boolean;
  }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <div className="flex gap-2">
        {multiline ? (
          <textarea
            value={profile[field]}
            onChange={(e) => handleProfileChange(field, e.target.value)}
            placeholder={placeholder}
            rows={3}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
          />
        ) : (
          <input
            type="text"
            value={profile[field]}
            onChange={(e) => handleProfileChange(field, e.target.value)}
            placeholder={placeholder}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
          />
        )}
        {profileDirty.has(field) && (
          <button
            onClick={() => saveProfileField(field, memoryKey, type)}
            disabled={profileSaving === field}
            className="px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1"
          >
            {profileSaving === field ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Save
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Your Profile Section */}
      <div>
        <button
          onClick={() => setShowProfile(!showProfile)}
          className="flex items-center justify-between w-full text-left"
        >
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Your Profile
          </h3>
          <span className="text-gray-400 text-sm">
            {showProfile ? '▼' : '▶'}
          </span>
        </button>
        
        {showProfile && (
          <div className="mt-3 space-y-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Tell the AI about yourself. This information is used to personalize responses across all conversations.
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              <ProfileField
                label="Nickname"
                field="nickname"
                memoryKey={PROFILE_KEYS.nickname}
                type="fact"
                placeholder="What should I call you?"
              />
              <ProfileField
                label="Occupation"
                field="occupation"
                memoryKey={PROFILE_KEYS.occupation}
                type="fact"
                placeholder="e.g., Software Engineer"
              />
            </div>
            
            <ProfileField
              label="Location"
              field="location"
              memoryKey={PROFILE_KEYS.location}
              type="fact"
              placeholder="e.g., San Francisco, CA"
            />
            
            <ProfileField
              label="About You"
              field="about"
              memoryKey={PROFILE_KEYS.about}
              type="fact"
              placeholder="Share anything you'd like the AI to know about you, your interests, background, etc."
              multiline
            />
            
            <div className="pt-2 border-t border-gray-200 dark:border-gray-600">
              <ProfileField
                label="Custom Instructions"
                field="instructions"
                memoryKey={PROFILE_KEYS.instructions}
                type="instruction"
                placeholder="How would you like the AI to respond? e.g., 'Be concise', 'Always include code examples', 'Use metric units'"
                multiline
              />
              <p className="mt-1 text-xs text-gray-400">
                These instructions will be applied to every conversation.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Divider */}
      <hr className="border-gray-200 dark:border-gray-700" />

      {/* Memories Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Memories
          </h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Memory
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          These are things the AI has learned about you from conversations. Say "remember..." to add more.
        </p>

      {/* Add Memory Form */}
      {showAddForm && (
        <form onSubmit={addMemory} className="mb-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
            <select
              value={newMemory.type}
              onChange={(e) => setNewMemory({ ...newMemory, type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="fact">Fact (personal info)</option>
              <option value="preference">Preference</option>
              <option value="project">Project</option>
              <option value="instruction">Instruction</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Memory Content
            </label>
            <textarea
              value={newMemory.value}
              onChange={(e) => setNewMemory({ ...newMemory, value: e.target.value })}
              placeholder="e.g., My favorite programming language is TypeScript"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none"
              rows={2}
              required
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isAdding}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {isAdding && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Memory
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Search and Filter */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
        >
          <option value="all">All Types</option>
          <option value="fact">Facts</option>
          <option value="preference">Preferences</option>
          <option value="project">Projects</option>
          <option value="instruction">Instructions</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : filteredMemories.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {memories.length === 0 ? (
            <>
              <Brain className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No memories yet</p>
              <p className="text-sm mt-1">Say "remember..." in a chat to create memories, or add one manually.</p>
            </>
          ) : (
            <p>No memories match your search</p>
          )}
        </div>
      ) : (
        <>
          {/* Memory List */}
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {filteredMemories.map((memory) => (
              <div
                key={memory.id}
                className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg flex items-start justify-between gap-3 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${memoryTypeLabels[memory.type]?.color || memoryTypeLabels.custom.color}`}>
                      {memoryTypeLabels[memory.type]?.label || memory.type}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(memory.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-white break-words">
                    {memory.value}
                  </p>
                </div>
                <button
                  onClick={() => deleteMemory(memory.id)}
                  disabled={deletingId === memory.id}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete memory"
                >
                  {deletingId === memory.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            ))}
          </div>

          {/* Summary and Clear All */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {filteredMemories.length} of {memories.filter(m => !profileKeyValues.includes(m.key)).length} memories
            </span>
            {memories.length > 0 && (
              <button
                onClick={deleteAllMemories}
                className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              >
                Clear All Memories
              </button>
            )}
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function DataTab({ onOpenImportExport }: { onOpenImportExport?: () => void }) {
  return (
    <div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
        Data Management
      </h3>

      <div className="space-y-4">
        <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <h4 className="font-medium text-gray-900 dark:text-white mb-2">
            Import & Export
          </h4>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            Export your conversations to backup or share, or import data from ChatGPT and other platforms.
          </p>
          <button
            onClick={onOpenImportExport}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
          >
            Open Import/Export
          </button>
        </div>

        <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <h4 className="font-medium text-gray-900 dark:text-white mb-2">
            Storage Usage
          </h4>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your data is stored securely in the cloud. File attachments are stored in Cloudflare R2.
          </p>
        </div>

        <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <h4 className="font-medium text-gray-900 dark:text-white mb-2">
            Clear Local Data
          </h4>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            Clear locally cached data like saved API keys. This won't affect your conversations.
          </p>
          <button
            onClick={() => {
              localStorage.clear();
              alert('Local data cleared');
            }}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-medium rounded-lg transition-colors"
          >
            Clear Local Data
          </button>
        </div>
      </div>
    </div>
  );
}
