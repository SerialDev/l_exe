/**
 * MessageList Component
 * Displays the conversation messages with artifact support
 */

import { useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { User, Bot, Copy, Check, RefreshCw, Volume2, VolumeX, Loader2 } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { useState } from 'react';
import type { Message } from '../../types';
import { parseArtifacts, InlineArtifact } from '../Artifacts/ArtifactViewer';
import * as api from '../../services/api';

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  streamingContent?: string;
  onRegenerate?: (messageId: string) => void;
  isRegenerating?: boolean;
}

function MessageBubble({ message, isStreaming, streamingContent, onRegenerate, isRegenerating }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const isUser = message.role === 'user';
  const rawContent = isStreaming ? streamingContent : message.content;
  
  // Parse artifacts from content
  const { text: content, artifacts } = useMemo(() => {
    if (!rawContent || isUser) return { text: rawContent || '', artifacts: [] };
    return parseArtifacts(rawContent);
  }, [rawContent, isUser]);
  
  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTextToSpeech = async () => {
    if (isPlaying && audioElement) {
      // Stop playing
      audioElement.pause();
      audioElement.currentTime = 0;
      setIsPlaying(false);
      return;
    }

    if (!content) return;

    setIsSynthesizing(true);
    try {
      const audioBlob = await api.synthesizeSpeech(content);
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };
      
      audio.onerror = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };
      
      setAudioElement(audio);
      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      console.error('TTS failed:', error);
    } finally {
      setIsSynthesizing(false);
    }
  };
  
  return (
    <div className={`py-6 ${isUser ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900'}`}>
      <div className="max-w-3xl mx-auto px-4 flex gap-4">
        {/* Avatar */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser 
            ? 'bg-green-600 text-white' 
            : 'bg-purple-600 text-white'
        }`}>
          {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 dark:text-white mb-1">
            {isUser ? 'You' : message.model || 'Assistant'}
          </div>
          
          <div className="prose dark:prose-invert max-w-none text-gray-800 dark:text-gray-200">
            {isUser ? (
              <p className="whitespace-pre-wrap">{content}</p>
            ) : (
              <ReactMarkdown
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const language = match ? match[1] : '';
                    const isInline = !language && !String(children).includes('\n');
                    
                    if (!isInline && language) {
                      return (
                        <div className="relative group">
                          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => navigator.clipboard.writeText(String(children))}
                              className="p-1 bg-gray-700 rounded text-gray-300 hover:text-white"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          </div>
                          <SyntaxHighlighter
                            style={oneDark as { [key: string]: React.CSSProperties }}
                            language={language}
                            PreTag="div"
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        </div>
                      );
                    }
                    
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {content || ''}
              </ReactMarkdown>
            )}
            
            {/* Streaming cursor */}
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-gray-500 animate-pulse ml-1" />
            )}
            
            {/* Render artifacts */}
            {!isUser && artifacts.length > 0 && (
              <div className="mt-4 space-y-4">
                {artifacts.map((artifact, index) => (
                  <InlineArtifact key={index} artifact={artifact} />
                ))}
              </div>
            )}
          </div>
          
          {/* Actions */}
          {!isUser && !isStreaming && content && (
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={copyToClipboard}
                className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded"
                title="Copy"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={() => onRegenerate?.(message.messageId)}
                disabled={isRegenerating}
                className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded disabled:opacity-50"
                title="Regenerate response"
              >
                <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={handleTextToSpeech}
                disabled={isSynthesizing}
                className={`p-1 rounded ${
                  isPlaying 
                    ? 'text-green-500 hover:text-green-600' 
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                } disabled:opacity-50`}
                title={isPlaying ? 'Stop audio' : 'Read aloud'}
              >
                {isSynthesizing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isPlaying ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
            </div>
          )}
          
          {/* Error indicator */}
          {message.error && (
            <div className="mt-2 text-red-500 text-sm">
              Error generating response
            </div>
          )}
          
          {/* Unfinished indicator */}
          {message.unfinished && (
            <div className="mt-2 text-yellow-500 text-sm">
              Response was stopped
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MessageList() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, isStreaming, streamingContent, streamingMessageId, regenerateMessage } = useChatStore();
  
  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);
  
  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-4">
          <Bot className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-600 mb-4" />
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
            How can I help you today?
          </h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-md">
            Start a conversation by typing a message below. I can help with writing, analysis, coding, math, and more.
          </p>
        </div>
      </div>
    );
  }
  
  const handleRegenerate = (messageId: string) => {
    if (!isStreaming) {
      regenerateMessage(messageId);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {messages.map((message) => (
        <MessageBubble 
          key={message.id} 
          message={message}
          onRegenerate={handleRegenerate}
          isRegenerating={isStreaming}
        />
      ))}
      
      {/* Streaming message */}
      {isStreaming && streamingMessageId && (
        <MessageBubble
          message={{
            id: streamingMessageId,
            messageId: streamingMessageId,
            conversationId: '',
            parentMessageId: null,
            role: 'assistant',
            content: '',
            model: null,
            endpoint: null,
            isCreatedByUser: false,
            createdAt: new Date().toISOString(),
          }}
          isStreaming
          streamingContent={streamingContent}
        />
      )}
      
      <div ref={messagesEndRef} />
    </div>
  );
}
