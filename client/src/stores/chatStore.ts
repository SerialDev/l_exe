/**
 * Chat Store
 * Manages conversations and messages with Zustand
 */

import { create } from 'zustand';
import type { Conversation, Message, SendMessageRequest, Endpoint } from '../types';
import * as api from '../services/api';

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
  newConversation: () => void;
}

let abortController: AbortController | null = null;

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
      set({ currentConversation: null, messages: [] });
      return;
    }
    
    set({ isLoading: true, error: null });
    try {
      const [conversation, messages] = await Promise.all([
        api.getConversation(id),
        api.getMessages(id),
      ]);
      
      set({
        currentConversation: conversation,
        messages,
        isLoading: false,
        // Update model/endpoint from conversation
        selectedModel: conversation.model,
        selectedEndpoint: conversation.endpoint as Endpoint,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load conversation',
        isLoading: false,
      });
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
    
    set({
      messages: [...messages, userMessage],
      isStreaming: true,
      streamingContent: '',
      error: null,
    });
    
    // Create abort controller
    abortController = new AbortController();
    
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
          
          onDone: (data) => {
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
          },
        },
        abortController.signal
      );
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // User cancelled
        set({
          isStreaming: false,
          streamingMessageId: null,
        });
      } else {
        set({
          error: error instanceof Error ? error.message : 'Failed to send message',
          isStreaming: false,
          streamingMessageId: null,
        });
      }
    }
    
    abortController = null;
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
    abortController = new AbortController();
    
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
        abortController.signal
      );
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        set({
          error: error instanceof Error ? error.message : 'Failed to regenerate message',
          isStreaming: false,
          streamingMessageId: null,
        });
      }
    }
    
    abortController = null;
  },

  // Stop message generation
  stopGeneration: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    
    // Save partial response as message
    const { streamingContent, streamingMessageId, currentConversation, messages } = get();
    
    if (streamingContent && streamingMessageId) {
      const partialMessage: Message = {
        id: streamingMessageId,
        messageId: streamingMessageId,
        conversationId: currentConversation?.conversationId || '',
        parentMessageId: messages.length > 0 ? messages[messages.length - 1].messageId : null,
        role: 'assistant',
        content: streamingContent,
        model: get().selectedModel,
        endpoint: get().selectedEndpoint,
        isCreatedByUser: false,
        unfinished: true,
        createdAt: new Date().toISOString(),
      };
      
      set({
        messages: [...messages, partialMessage],
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null,
      });
    } else {
      set({
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null,
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
  
  newConversation: () => set({
    currentConversation: null,
    messages: [],
    streamingContent: '',
    streamingMessageId: null,
    error: null,
  }),
}));
