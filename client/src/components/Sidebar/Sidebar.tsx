/**
 * Sidebar Component
 * Conversation list and navigation with search
 */

import { useEffect, useState, useCallback } from 'react';
import { 
  MessageSquare, 
  Plus, 
  Settings, 
  LogOut, 
  Trash2, 
  Edit2, 
  Check, 
  X,
  Menu,
  ChevronLeft,
  Search,
  Loader2
} from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import * as api from '../../services/api';
import clsx from 'clsx';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onOpenSettings?: () => void;
}

export function Sidebar({ isOpen, onToggle, onOpenSettings }: SidebarProps) {
  const {
    conversations,
    currentConversation,
    loadConversations,
    selectConversation,
    deleteConversation,
    renameConversation,
    newConversation,
  } = useChatStore();
  
  const { user, logout } = useAuthStore();
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<api.SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);
  
  const handleStartEdit = (id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  };
  
  const handleSaveEdit = async () => {
    if (editingId && editTitle.trim()) {
      await renameConversation(editingId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle('');
  };
  
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };
  
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      await deleteConversation(id);
    }
  };

  // Debounced search
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setIsSearching(true);
    setShowSearchResults(true);
    try {
      const response = await api.searchConversations(query, { pageSize: 10 });
      setSearchResults(response.results);
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  const handleSearchResultClick = (result: api.SearchResult) => {
    selectConversation(result.conversationId);
    setSearchQuery('');
    setShowSearchResults(false);
  };
  
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}
      
      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed lg:static inset-y-0 left-0 z-50 w-72 bg-gray-900 text-white flex flex-col transition-transform duration-300',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-0 lg:overflow-hidden'
        )}
      >
        {/* Header */}
        <div className="p-4 flex items-center justify-between border-b border-gray-700">
          <button
            onClick={newConversation}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors flex-1 mr-2"
          >
            <Plus className="w-5 h-5" />
            <span>New Chat</span>
          </button>
          
          <button
            onClick={onToggle}
            className="p-2 hover:bg-gray-800 rounded-lg lg:hidden"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-4 py-2 bg-gray-800 text-white placeholder-gray-400 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
            )}
          </div>

          {/* Search Results */}
          {showSearchResults && searchResults.length > 0 && (
            <div className="mt-2 bg-gray-800 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
              {searchResults.map((result) => (
                <button
                  key={`${result.conversationId}-${result.messageId}`}
                  onClick={() => handleSearchResultClick(result)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-700 border-b border-gray-700 last:border-0"
                >
                  <div className="text-sm font-medium text-white truncate">
                    {result.conversationTitle}
                  </div>
                  <div className="text-xs text-gray-400 truncate mt-1">
                    {result.content.slice(0, 100)}...
                  </div>
                </button>
              ))}
            </div>
          )}

          {showSearchResults && searchQuery && !isSearching && searchResults.length === 0 && (
            <div className="mt-2 p-3 bg-gray-800 rounded-lg text-center text-sm text-gray-400">
              No results found
            </div>
          )}
        </div>
        
        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No conversations yet
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => {
                const isActive = currentConversation?.conversationId === conv.conversationId;
                const isEditing = editingId === conv.conversationId;
                
                return (
                  <div
                    key={conv.conversationId}
                    className={clsx(
                      'group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                      isActive
                        ? 'bg-gray-700'
                        : 'hover:bg-gray-800'
                    )}
                    onClick={() => !isEditing && selectConversation(conv.conversationId)}
                  >
                    <MessageSquare className="w-4 h-4 flex-shrink-0 text-gray-400" />
                    
                    {isEditing ? (
                      <div className="flex-1 flex items-center gap-1">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="flex-1 bg-gray-700 px-2 py-1 rounded text-sm outline-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                        />
                        <button
                          onClick={handleSaveEdit}
                          className="p-1 hover:bg-gray-600 rounded"
                        >
                          <Check className="w-4 h-4 text-green-400" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-1 hover:bg-gray-600 rounded"
                        >
                          <X className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1 text-sm truncate">
                          {conv.title || 'New Chat'}
                        </span>
                        
                        <div className="hidden group-hover:flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEdit(conv.conversationId, conv.title);
                            }}
                            className="p-1 hover:bg-gray-600 rounded"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(conv.conversationId, e)}
                            className="p-1 hover:bg-gray-600 rounded text-red-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-gray-700 space-y-2">
          {user && (
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-sm font-medium">
                {(user.name?.[0] || user.email?.[0] || 'U').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user.name || user.email}</div>
                <div className="text-xs text-gray-400 truncate">{user.email}</div>
              </div>
            </div>
          )}
          
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Settings className="w-5 h-5" />
            <span>Settings</span>
          </button>
          
          <button
            onClick={() => logout()}
            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-800 rounded-lg transition-colors text-red-400"
          >
            <LogOut className="w-5 h-5" />
            <span>Log out</span>
          </button>
        </div>
      </aside>
      
      {/* Toggle button (when sidebar is closed) */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed top-4 left-4 z-40 p-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}
    </>
  );
}
