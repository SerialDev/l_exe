/**
 * ChatInput Component
 * Text area for composing and sending messages with file attachments and voice input
 */

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Square, Paperclip, X, Image, FileText, Loader2, Mic, MicOff } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import * as api from '../../services/api';

interface AttachedFile {
  id: string;
  file: File;
  preview?: string;
  uploading: boolean;
  uploaded: boolean;
  error?: string;
  uploadedFile?: api.UploadedFile;
}

export function ChatInput() {
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const { isStreaming, sendMessage, stopGeneration, currentConversation } = useChatStore();
  
  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Cleanup previews and recording on unmount
  useEffect(() => {
    return () => {
      attachedFiles.forEach(f => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const uploadFile = async (file: File): Promise<api.UploadedFile | null> => {
    try {
      const isImage = file.type.startsWith('image/');
      const response = isImage
        ? await api.uploadImage(file)
        : await api.uploadFile(file, 'attachment', currentConversation?.conversationId);
      
      if (response.success && response.file) {
        return response.file;
      }
      return null;
    } catch (error) {
      console.error('Upload failed:', error);
      return null;
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    
    // Create attached file entries
    const newAttachedFiles: AttachedFile[] = fileArray.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      uploading: true,
      uploaded: false,
    }));

    setAttachedFiles(prev => [...prev, ...newAttachedFiles]);

    // Upload files in parallel
    for (const attached of newAttachedFiles) {
      const uploadedFile = await uploadFile(attached.file);
      
      setAttachedFiles(prev => prev.map(f => {
        if (f.id === attached.id) {
          return {
            ...f,
            uploading: false,
            uploaded: !!uploadedFile,
            uploadedFile: uploadedFile || undefined,
            error: uploadedFile ? undefined : 'Upload failed',
          };
        }
        return f;
      }));
    }
  };

  const removeFile = (id: string) => {
    setAttachedFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file?.preview) {
        URL.revokeObjectURL(file.preview);
      }
      // Optionally delete from server if already uploaded
      if (file?.uploadedFile) {
        api.deleteFile(file.uploadedFile.id).catch(console.error);
      }
      return prev.filter(f => f.id !== id);
    });
  };

  // Voice recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });
      
      audioChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
        // Clear the timer
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        
        // Create blob and transcribe
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: mediaRecorder.mimeType 
        });
        
        if (audioBlob.size > 0) {
          setIsTranscribing(true);
          try {
            const result = await api.transcribeAudio(audioBlob);
            if (result.success && result.text) {
              setInput(prev => prev + (prev ? ' ' : '') + result.text);
            }
          } catch (error) {
            console.error('Transcription failed:', error);
          } finally {
            setIsTranscribing(false);
          }
        }
        
        setRecordingTime(0);
      };
      
      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      
      // Start recording timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Could not access microphone. Please check your browser permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const formatRecordingTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSubmit = () => {
    if ((!input.trim() && attachedFiles.length === 0) || isStreaming) return;
    
    // Get uploaded file IDs
    const fileIds = attachedFiles
      .filter(f => f.uploaded && f.uploadedFile)
      .map(f => f.uploadedFile!.id);

    // Build message text with file references if needed
    let messageText = input.trim();
    
    // If we have files, include their info in the message for the AI to see
    if (fileIds.length > 0) {
      const fileDescriptions = attachedFiles
        .filter(f => f.uploaded && f.uploadedFile)
        .map(f => `[Attached: ${f.uploadedFile!.originalName}]`)
        .join(' ');
      
      messageText = messageText 
        ? `${messageText}\n\n${fileDescriptions}`
        : fileDescriptions;
    }

    sendMessage(messageText, fileIds);
    setInput('');
    setAttachedFiles([]);
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };
  
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];
    
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    
    if (files.length > 0) {
      handleFiles(files);
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return Image;
    return FileText;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  
  return (
    <div 
      className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="max-w-3xl mx-auto">
        {/* Attached files preview */}
        {attachedFiles.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachedFiles.map(attached => {
              const FileIcon = getFileIcon(attached.file.type);
              return (
                <div
                  key={attached.id}
                  className={`relative group flex items-center gap-2 px-3 py-2 rounded-lg border ${
                    attached.error
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                      : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600'
                  }`}
                >
                  {/* Preview or icon */}
                  {attached.preview ? (
                    <img 
                      src={attached.preview} 
                      alt={attached.file.name}
                      className="w-10 h-10 object-cover rounded"
                    />
                  ) : (
                    <FileIcon className="w-8 h-8 text-gray-500 dark:text-gray-400" />
                  )}
                  
                  {/* File info */}
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[150px]">
                      {attached.file.name}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {formatFileSize(attached.file.size)}
                    </span>
                  </div>
                  
                  {/* Status indicator */}
                  {attached.uploading && (
                    <Loader2 className="w-4 h-4 animate-spin text-green-500" />
                  )}
                  {attached.error && (
                    <span className="text-xs text-red-500">{attached.error}</span>
                  )}
                  
                  {/* Remove button */}
                  <button
                    onClick={() => removeFile(attached.id)}
                    className="absolute -top-2 -right-2 p-1 bg-gray-800 dark:bg-gray-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Recording indicator */}
        {isRecording && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm text-red-600 dark:text-red-400">
              Recording... {formatRecordingTime(recordingTime)}
            </span>
          </div>
        )}

        {/* Transcribing indicator */}
        {isTranscribing && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            <span className="text-sm text-blue-600 dark:text-blue-400">
              Transcribing audio...
            </span>
          </div>
        )}

        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-green-500/10 border-2 border-dashed border-green-500 rounded-2xl flex items-center justify-center z-10">
            <span className="text-green-600 dark:text-green-400 font-medium">
              Drop files here
            </span>
          </div>
        )}

        <div className="relative flex items-end gap-2 bg-gray-100 dark:bg-gray-700 rounded-2xl p-3">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />

          {/* Attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            title="Attach file (images, PDF, text, etc.)"
            disabled={isStreaming || isRecording}
          >
            <Paperclip className="w-5 h-5" />
          </button>

          {/* Voice input button */}
          <button
            onClick={toggleRecording}
            className={`p-2 rounded-lg transition-colors ${
              isRecording
                ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
            title={isRecording ? 'Stop recording' : 'Voice input'}
            disabled={isStreaming || isTranscribing}
          >
            {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          
          {/* Text input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isRecording ? 'Recording...' : 'Message L_EXE...'}
            className="flex-1 bg-transparent border-0 outline-none resize-none text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 max-h-[200px]"
            rows={1}
            disabled={isStreaming || isRecording}
          />
          
          {/* Send/Stop button */}
          {isStreaming ? (
            <button
              onClick={stopGeneration}
              className="p-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
              title="Stop generating"
            >
              <Square className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={(!input.trim() && attachedFiles.filter(f => f.uploaded).length === 0) || isRecording}
              className="p-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
        
        <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-2">
          L_EXE can make mistakes. Consider checking important information.
        </p>
      </div>
    </div>
  );
}
