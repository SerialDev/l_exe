/**
 * Chat Store
 * Manages conversations and messages with Zustand
 */

import { create } from 'zustand';
import type { Conversation, Message, SendMessageRequest, Endpoint } from '../types';
import * as api from '../services/api';
import { encryptConversationMessages, decryptMessages, isEncryptionEnabled } from '../services/encryptedApi';

interface ChatStore {
  // State
  conversations: Conversation[];
  currentConversation: Conversation | null;
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingMessageId: string | null;
  streamingContent: string;
  error: string | null;
  encryptionError: string | null;
  abortController: AbortController | null;
  loadingConversationId: string | null;
  
  // Settings
  selectedModel: string;
  selectedEndpoint: Endpoint;
  temperature: number;
  systemPrompt: string;
  
  // Actions
  loadConversations: () => Promise<void>;
  selectConversation: (id: string | null) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  
  sendMessage: (text: string, fileIds?: string[]) => Promise<void>;
  regenerateMessage: (messageId: string) => Promise<void>;
  stopGeneration: () => void;
  
  setModel: (model: string) => void;
  setEndpoint: (endpoint: Endpoint) => void;
  setTemperature: (temp: number) => void;
  setSystemPrompt: (prompt: string) => void;
  
  clearError: () => void;
  clearEncryptionError: () => void;
  newConversation: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // Initial state
  conversations: [],
  currentConversation: null,
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingMessageId: null,
  streamingContent: '',
  error: null,
  encryptionError: null,
  abortController: null,
  loadingConversationId: null,
  
  // Default settings
  selectedModel: 'gpt-4o',
  selectedEndpoint: 'openAI',
  temperature: 0.7,
  systemPrompt: '',
  
  // Load conversations list
  loadConversations: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.getConversations();
      set({ conversations: response.conversations, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load conversations',
        isLoading: false,
      });
    }
  },
  
  // Select and load a conversation
  selectConversation: async (id) => {
    if (!id) {
      set({ currentConversation: null, messages: [], loadingConversationId: null });
      return;
    }
    
    // Store which conversation we're loading to handle race conditions
    set({ isLoading: true, error: null, loadingConversationId: id });
    
    try {
      const [conversation, messagesRaw] = await Promise.all([
        api.getConversation(id),
        api.getMessages(id),
      ]);
      
      // Check if this is still the conversation we want (handle rapid clicks)
      if (get().loadingConversationId !== id) {
        return; // User clicked another conversation, discard this result
      }
      
      // Decrypt messages if encryption is enabled (E2EE)
      const messages = await decryptMessages(messagesRaw);
      
      set({
        currentConversation: conversation,
        messages,
        isLoading: false,
        loadingConversationId: null,
        // Update model/endpoint from conversation
        selectedModel: conversation.model,
        selectedEndpoint: conversation.endpoint as Endpoint,
      });
    } catch (error) {
      // Only set error if this is still the active request
      if (get().loadingConversationId === id) {
        set({
          error: error instanceof Error ? error.message : 'Failed to load conversation',
          isLoading: false,
          loadingConversationId: null,
        });
      }
    }
  },
  
  // Delete a conversation
  deleteConversation: async (id) => {
    try {
      await api.deleteConversation(id);
      const { conversations, currentConversation } = get();
      set({
        conversations: conversations.filter(c => c.id !== id && c.conversationId !== id),
        ...(currentConversation?.id === id || currentConversation?.conversationId === id
          ? { currentConversation: null, messages: [] }
          : {}),
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete conversation' });
    }
  },
  
  // Rename a conversation
  renameConversation: async (id, title) => {
    try {
      const updated = await api.updateConversationTitle(id, title);
      const { conversations } = get();
      set({
        conversations: conversations.map(c =>
          c.id === id || c.conversationId === id ? { ...c, title } : c
        ),
        currentConversation: get().currentConversation?.id === id
          ? { ...get().currentConversation!, title }
          : get().currentConversation,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to rename conversation' });
    }
  },
  
  // Send a message with streaming
  sendMessage: async (text, fileIds) => {
    const { currentConversation, messages, selectedModel, selectedEndpoint, temperature, systemPrompt } = get();
    
    // Create optimistic user message
    const userMessageId = `temp-${Date.now()}`;
    const userMessage: Message = {
      id: userMessageId,
      messageId: userMessageId,
      conversationId: currentConversation?.conversationId || '',
      parentMessageId: messages.length > 0 ? messages[messages.length - 1].messageId : null,
      role: 'user',
      content: text,
      model: selectedModel,
      endpoint: selectedEndpoint,
      isCreatedByUser: true,
      createdAt: new Date().toISOString(),
    };
    
    // Abort any existing request first
    const existingController = get().abortController;
    if (existingController) {
      existingController.abort();
    }
    
    // Create new abort controller
    const newAbortController = new AbortController();
    
    set({
      messages: [...messages, userMessage],
      isStreaming: true,
      streamingContent: '',
      error: null,
      encryptionError: null,
      abortController: newAbortController,
    });
    
    const request: SendMessageRequest & { files?: string[] } = {
      conversationId: currentConversation?.conversationId,
      parentMessageId: userMessage.parentMessageId || undefined,
      endpoint: selectedEndpoint,
      model: selectedModel,
      text,
      promptPrefix: systemPrompt || undefined,
      temperature,
      ...(fileIds && fileIds.length > 0 ? { files: fileIds } : {}),
    };
    
    try {
      await api.sendMessageStream(
        request,
        {
          onStart: (data) => {
            // Update with real IDs
            set((state) => ({
              streamingMessageId: data.messageId,
              currentConversation: state.currentConversation || {
                id: data.conversationId,
                conversationId: data.conversationId,
                title: text.slice(0, 50),
                endpoint: data.endpoint,
                model: data.model,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              messages: state.messages.map(m =>
                m.id === userMessageId
                  ? { ...m, conversationId: data.conversationId, messageId: data.parentMessageId }
                  : m
              ),
            }));
          },
          
          onMessage: (data) => {
            set((state) => ({
              streamingContent: state.streamingContent + data.text,
            }));
          },
          
          onError: (data) => {
            set({
              error: data.message,
              isStreaming: false,
              streamingMessageId: null,
            });
          },
          
          onDone: async (data) => {
            console.log('[ChatStore] onDone called with:', data);
            const assistantMessage: Message = {
              id: data.messageId,
              messageId: data.messageId,
              conversationId: data.conversationId,
              parentMessageId: data.parentMessageId,
              role: 'assistant',
              content: data.text,
              model: data.model,
              endpoint: data.endpoint,
              isCreatedByUser: false,
              tokenCount: data.tokenCount,
              createdAt: new Date().toISOString(),
            };
            
            console.log('[ChatStore] Setting isStreaming to false');
            set((state) => ({
              messages: [...state.messages, assistantMessage],
              isStreaming: false,
              streamingContent: '',
              streamingMessageId: null,
              // Add to conversations if new
              conversations: state.currentConversation
                ? state.conversations.some(c => c.conversationId === data.conversationId)
                  ? state.conversations
                  : [state.currentConversation, ...state.conversations]
                : state.conversations,
            }));
            console.log('[ChatStore] State updated, isStreaming should be false');
            
            // Encrypt messages in storage (E2EE)
            // This happens in the background after the UI updates
            if (isEncryptionEnabled()) {
              const userMsgId = data.parentMessageId;
              if (userMsgId) {
                try {
                  await encryptConversationMessages(
                    userMsgId,
                    text, // Original user message text
                    data.messageId,
                    data.text // AI response text
                  );
                } catch (err) {
                  console.error('[E2EE] Failed to encrypt messages:', err);
                  set({ 
                    encryptionError: 'Failed to encrypt messages. Your messages may be stored unencrypted.' 
                  });
                }
              }
            }
          },
        },
        newAbortController.signal
      );
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // User cancelled
        set({
          isStreaming: false,
          streamingMessageId: null,
          abortController: null,
        });
      } else {
        set({
          error: error instanceof Error ? error.message : 'Failed to send message',
          isStreaming: false,
          streamingMessageId: null,
          abortController: null,
        });
      }
    }
    
    set({ abortController: null });
  },
  
  // Regenerate a message
  regenerateMessage: async (messageId) => {
    const { messages, selectedModel, selectedEndpoint, currentConversation } = get();
    
    if (!currentConversation) return;
    
    // Find the message to regenerate and its parent
    const messageIndex = messages.findIndex(m => m.messageId === messageId);
    if (messageIndex === -1) return;
    
    const message = messages[messageIndex];
    const parentMessageId = message.parentMessageId;
    
    // Remove the message being regenerated
    set({
      messages: messages.slice(0, messageIndex),
      isStreaming: true,
      streamingContent: '',
      error: null,
    });
    
    // Create abort controller
    const newAbortController = new AbortController();
    set({ abortController: newAbortController });
    
    try {
      await api.regenerateMessage(
        currentConversation.conversationId,
        parentMessageId || '',
        selectedEndpoint,
        selectedModel,
        {
          onStart: (data) => {
            set({ streamingMessageId: data.messageId });
          },
          
          onMessage: (data) => {
            set((state) => ({
              streamingContent: state.streamingContent + data.text,
            }));
          },
          
          onError: (data) => {
            set({
              error: data.message,
              isStreaming: false,
              streamingMessageId: null,
            });
          },
          
          onDone: (data) => {
            const regeneratedMessage: Message = {
              id: data.messageId,
              messageId: data.messageId,
              conversationId: data.conversationId,
              parentMessageId: data.parentMessageId,
              role: 'assistant',
              content: data.text,
              model: data.model,
              endpoint: data.endpoint,
              isCreatedByUser: false,
              tokenCount: data.tokenCount,
              createdAt: new Date().toISOString(),
            };
            
            set((state) => ({
              messages: [...state.messages, regeneratedMessage],
              isStreaming: false,
              streamingContent: '',
              streamingMessageId: null,
            }));
          },
        },
        newAbortController.signal
      );
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        set({
          error: error instanceof Error ? error.message : 'Failed to regenerate message',
          isStreaming: false,
          streamingMessageId: null,
          abortController: null,
        });
      }
    }
    
    set({ abortController: null });
  },

  // Stop message generation
  stopGeneration: () => {
    const currentAbortController = get().abortController;
    if (currentAbortController) {
      currentAbortController.abort();
    }
    
    // Get all state at once to avoid stale state issues
    const state = get();
    const { streamingContent, streamingMessageId, currentConversation, messages, selectedModel, selectedEndpoint } = state;
    
    if (streamingContent && streamingMessageId) {
      const partialMessage: Message = {
        id: streamingMessageId,
        messageId: streamingMessageId,
        conversationId: currentConversation?.conversationId || '',
        parentMessageId: messages.length > 0 ? messages[messages.length - 1].messageId : null,
        role: 'assistant',
        content: streamingContent,
        model: selectedModel,
        endpoint: selectedEndpoint,
        isCreatedByUser: false,
        unfinished: true,
        createdAt: new Date().toISOString(),
      };
      
      set({
        messages: [...messages, partialMessage],
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null,
        abortController: null,
      });
    } else {
      set({
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null,
        abortController: null,
      });
    }
  },
  
  // Settings
  setModel: (model) => set({ selectedModel: model }),
  setEndpoint: (endpoint) => set({ selectedEndpoint: endpoint }),
  setTemperature: (temp) => set({ temperature: temp }),
  setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
  
  // Utilities
  clearError: () => set({ error: null }),
  clearEncryptionError: () => set({ encryptionError: null }),
  
  newConversation: () => set({
    currentConversation: null,
    messages: [],
    streamingContent: '',
    streamingMessageId: null,
    error: null,
  }),
}));
