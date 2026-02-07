/**
 * Import/Export Modal Component
 * Import and export conversation data
 */

import { useState, useRef } from 'react';
import {
  X,
  Upload,
  Download,
  FileJson,
  FileText,
  FileCode,
  Check,
  AlertCircle,
  Loader2,
  Scissors,
  Package,
} from 'lucide-react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import * as api from '../../services/api';
import { useChatStore } from '../../stores/chatStore';

// Type for split output format
type SplitOutputFormat = 'json' | 'pdf';

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExportFormat = 'json' | 'markdown' | 'text' | 'html';

const formatOptions: { value: ExportFormat; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'json', label: 'JSON', icon: <FileJson className="w-5 h-5" />, description: 'Full data, re-importable' },
  { value: 'markdown', label: 'Markdown', icon: <FileText className="w-5 h-5" />, description: 'Readable format with formatting' },
  { value: 'text', label: 'Plain Text', icon: <FileText className="w-5 h-5" />, description: 'Simple text format' },
  { value: 'html', label: 'HTML', icon: <FileCode className="w-5 h-5" />, description: 'Web page format' },
];

// Batch size for large imports
const BATCH_SIZE = 50;

interface ImportProgress {
  currentBatch: number;
  totalBatches: number;
  processedConversations: number;
  totalConversations: number;
  status: 'parsing' | 'importing' | 'done' | 'error';
}

// Split progress tracking
interface SplitProgress {
  status: 'parsing' | 'splitting' | 'zipping' | 'done' | 'error';
  totalConversations: number;
  processedConversations: number;
}

export function ImportExportModal({ isOpen, onClose }: ImportExportModalProps) {
  const [activeTab, setActiveTab] = useState<'export' | 'import' | 'tools'>('export');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [exportScope, setExportScope] = useState<'current' | 'all'>('current');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitOutputFormat, setSplitOutputFormat] = useState<SplitOutputFormat>('json');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [importResult, setImportResult] = useState<api.ImportResult | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [splitProgress, setSplitProgress] = useState<SplitProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const splitFileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { currentConversation, loadConversations } = useChatStore();

  if (!isOpen) return null;

  const handleExport = async () => {
    if (exportScope === 'current' && !currentConversation) {
      setMessage({ type: 'error', text: 'No conversation selected' });
      return;
    }

    setIsExporting(true);
    setMessage(null);

    try {
      const blob = exportScope === 'all'
        ? await api.exportAllConversations(exportFormat)
        : await api.exportConversation(currentConversation!.conversationId, exportFormat);

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportScope === 'all'
        ? `l_exe_export_all.${exportFormat === 'markdown' ? 'md' : exportFormat}`
        : `l_exe_${currentConversation!.title.slice(0, 20).replace(/\s+/g, '_')}.${exportFormat === 'markdown' ? 'md' : exportFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setMessage({ type: 'success', text: 'Export completed!' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Export failed' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create new AbortController for this import
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsImporting(true);
    setMessage(null);
    setImportResult(null);
    setImportProgress({ currentBatch: 0, totalBatches: 0, processedConversations: 0, totalConversations: 0, status: 'parsing' });

    try {
      // Parse the JSON file locally first
      const text = await file.text();
      let data: unknown[];
      
      try {
        const parsed = JSON.parse(text);
        // Normalize to array
        data = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        throw new Error('Invalid JSON file');
      }

      const totalConversations = data.length;
      const totalBatches = Math.ceil(totalConversations / BATCH_SIZE);
      
      setImportProgress({
        currentBatch: 0,
        totalBatches,
        processedConversations: 0,
        totalConversations,
        status: 'importing'
      });

      // Aggregate results across all batches
      const aggregatedResult: api.ImportResult = {
        total: 0,
        successful: 0,
        failed: 0,
        withSystemMessage: 0,
        uniqueProfiles: [],
        results: []
      };

      // Process in batches
      for (let i = 0; i < totalBatches; i++) {
        // Check if cancelled
        if (abortController.signal.aborted) {
          setMessage({ type: 'error', text: `Import cancelled after ${aggregatedResult.successful} conversations` });
          break;
        }

        const start = i * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, totalConversations);
        const batch = data.slice(start, end);

        setImportProgress(prev => prev ? {
          ...prev,
          currentBatch: i + 1,
          status: 'importing'
        } : null);

        // Send batch as JSON directly (not as file upload)
        try {
          const result = await api.importConversationsJson(batch, abortController.signal);
          
          // Aggregate results
          aggregatedResult.total += result.total;
          aggregatedResult.successful += result.successful;
          aggregatedResult.failed += result.failed;
          aggregatedResult.withSystemMessage += result.withSystemMessage;
          if (result.results) {
            aggregatedResult.results.push(...result.results);
          }
          
          // Merge unique profiles (deduplicate by id)
          if (result.uniqueProfiles) {
            for (const profile of result.uniqueProfiles) {
              const existing = aggregatedResult.uniqueProfiles.find(p => p.id === profile.id);
              if (existing) {
                existing.conversationCount += profile.conversationCount;
              } else {
                aggregatedResult.uniqueProfiles.push({ ...profile });
              }
            }
          }
        } catch (error) {
          console.error(`Batch ${i + 1} failed:`, error);
          // Continue with next batch, count these as failed
          aggregatedResult.total += batch.length;
          aggregatedResult.failed += batch.length;
        }

        setImportProgress(prev => prev ? {
          ...prev,
          processedConversations: end
        } : null);

        // Small delay between batches to avoid overwhelming the server
        if (i < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Sort profiles by conversation count
      aggregatedResult.uniqueProfiles.sort((a, b) => b.conversationCount - a.conversationCount);

      setImportResult(aggregatedResult);
      setImportProgress(prev => prev ? { ...prev, status: 'done' } : null);
      
      // Count skipped (already imported) vs actual errors
      const skipped = aggregatedResult.results?.filter(r => r.error === 'Conversation already imported').length ?? 0;
      const actualErrors = aggregatedResult.failed - skipped;
      
      if (aggregatedResult.successful > 0) {
        const totalMessages = aggregatedResult.results?.reduce((sum, r) => sum + r.messagesImported, 0) ?? 0;
        let text = `Imported ${aggregatedResult.successful} conversations with ${totalMessages} messages`;
        if (skipped > 0) {
          text += ` (${skipped} already existed)`;
        }
        setMessage({ type: 'success', text });
        // Refresh conversation list
        loadConversations();
      } else if (skipped > 0 && actualErrors === 0) {
        // All were skipped (duplicates)
        setMessage({ type: 'success', text: `All ${skipped} conversations were already imported` });
      } else if (actualErrors > 0) {
        const errors = aggregatedResult.results?.filter(r => r.error && r.error !== 'Conversation already imported').map(r => r.error) ?? [];
        setMessage({ type: 'error', text: errors.slice(0, 3).join(', ') || 'Import failed' });
      }
    } catch (error) {
      // Don't show error if it was just cancelled
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      setImportProgress(prev => prev ? { ...prev, status: 'error' } : null);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Import failed' });
    } finally {
      setIsImporting(false);
      abortControllerRef.current = null;
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleCancelImport = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setMessage({ type: 'error', text: 'Cancelling...' });
    }
  };

  /**
   * Generate a sanitized filename from conversation data
   */
  const generateFilename = (
    conversation: Record<string, unknown>, 
    index: number, 
    extension: string
  ): string => {
    const title = conversation.title as string | undefined;
    const id = conversation.id || conversation.conversationId || conversation.conversation_id;
    
    if (title) {
      const sanitizedTitle = title
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 50);
      return `${String(index + 1).padStart(4, '0')}_${sanitizedTitle}.${extension}`;
    } else if (id) {
      return `${String(index + 1).padStart(4, '0')}_${id}.${extension}`;
    }
    return `conversation_${String(index + 1).padStart(4, '0')}.${extension}`;
  };

  /**
   * Extract messages from various conversation formats
   */
  const extractMessages = (conversation: Record<string, unknown>): Array<{ role: string; content: string; author?: string }> => {
    const messages: Array<{ role: string; content: string; author?: string }> = [];
    
    // ChatGPT format: mapping object with message nodes
    if (conversation.mapping && typeof conversation.mapping === 'object') {
      const mapping = conversation.mapping as Record<string, { message?: { author?: { role?: string }; content?: { parts?: string[] } } }>;
      
      // Find root and traverse
      const nodes = Object.values(mapping);
      for (const node of nodes) {
        if (node.message?.content?.parts && node.message.author?.role) {
          const role = node.message.author.role;
          const content = node.message.content.parts.join('\n');
          if (content.trim() && (role === 'user' || role === 'assistant')) {
            messages.push({ role, content });
          }
        }
      }
    }
    
    // Standard messages array format
    if (Array.isArray(conversation.messages)) {
      for (const msg of conversation.messages) {
        const m = msg as Record<string, unknown>;
        const role = (m.role || m.author || 'unknown') as string;
        const content = (m.content || m.text || '') as string;
        if (content.trim()) {
          messages.push({ role, content });
        }
      }
    }
    
    return messages;
  };

  /**
   * Create a PDF from a conversation
   */
  const createConversationPDF = (
    conversation: Record<string, unknown>,
    index: number,
    total: number,
    originalFilename: string
  ): ArrayBuffer => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    let yPos = margin;
    
    const title = (conversation.title as string) || `Conversation ${index + 1}`;
    const createTime = conversation.create_time || conversation.created_at || conversation.createdAt;
    
    // Helper to add new page if needed
    const checkNewPage = (neededHeight: number) => {
      if (yPos + neededHeight > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
        return true;
      }
      return false;
    };
    
    // Helper to wrap text and return lines
    const wrapText = (text: string, maxWidth: number, fontSize: number): string[] => {
      doc.setFontSize(fontSize);
      return doc.splitTextToSize(text, maxWidth);
    };
    
    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    const titleLines = wrapText(title, contentWidth, 16);
    doc.text(titleLines, margin, yPos);
    yPos += titleLines.length * 7 + 3;
    
    // Metadata
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(128, 128, 128);
    
    if (createTime) {
      const timestamp = typeof createTime === 'number' ? createTime * 1000 : String(createTime);
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        doc.text(`Created: ${date.toLocaleString()}`, margin, yPos);
        yPos += 5;
      }
    }
    doc.text(`Conversation ${index + 1} of ${total}`, margin, yPos);
    yPos += 5;
    doc.text(`Source: ${originalFilename}`, margin, yPos);
    yPos += 8;
    
    // Separator line
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 8;
    
    // Reset text color
    doc.setTextColor(0, 0, 0);
    
    // Extract and render messages
    const messages = extractMessages(conversation);
    
    if (messages.length === 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(128, 128, 128);
      doc.text('No messages found in this conversation.', margin, yPos);
    } else {
      for (const msg of messages) {
        const isUser = msg.role === 'user';
        const roleLabel = isUser ? 'You' : 'Assistant';
        const bgColor = isUser ? [240, 240, 255] : [245, 245, 245];
        
        // Calculate message height
        doc.setFontSize(10);
        const contentLines = wrapText(msg.content, contentWidth - 10, 10);
        const messageHeight = 8 + (contentLines.length * 5) + 8;
        
        checkNewPage(messageHeight);
        
        // Draw background
        doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
        doc.roundedRect(margin, yPos, contentWidth, messageHeight, 2, 2, 'F');
        
        // Role label
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(isUser ? 70 : 50, isUser ? 70 : 120, isUser ? 150 : 50);
        doc.text(roleLabel, margin + 5, yPos + 6);
        
        // Message content
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 30, 30);
        doc.text(contentLines, margin + 5, yPos + 12);
        
        yPos += messageHeight + 4;
      }
    }
    
    // Footer on last page
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${i} of ${pageCount} | Generated by L_EXE`,
        pageWidth / 2,
        pageHeight - 8,
        { align: 'center' }
      );
    }
    
    return doc.output('arraybuffer');
  };

  /**
   * Handle splitting a large JSON blob into individual conversation files
   * Creates a zip file with each conversation as a separate JSON or PDF file
   */
  const handleSplitFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSplitting(true);
    setMessage(null);
    setSplitProgress({ status: 'parsing', totalConversations: 0, processedConversations: 0 });

    try {
      // Parse the JSON file
      const text = await file.text();
      let data: unknown[];
      
      try {
        const parsed = JSON.parse(text);
        // Normalize to array
        data = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        throw new Error('Invalid JSON file');
      }

      const totalConversations = data.length;
      
      if (totalConversations === 0) {
        throw new Error('No conversations found in file');
      }

      setSplitProgress({ 
        status: 'splitting', 
        totalConversations, 
        processedConversations: 0 
      });

      // Create a new zip file
      const zip = new JSZip();
      const extension = splitOutputFormat === 'pdf' ? 'pdf' : 'json';
      
      // Process each conversation
      for (let i = 0; i < data.length; i++) {
        const conversation = data[i] as Record<string, unknown>;
        const filename = generateFilename(conversation, i, extension);
        
        if (splitOutputFormat === 'pdf') {
          // Generate PDF
          const pdfBuffer = createConversationPDF(
            conversation, 
            i, 
            totalConversations, 
            file.name
          );
          zip.file(filename, pdfBuffer);
        } else {
          // Generate JSON
          const enrichedConversation = {
            ...conversation,
            _split_metadata: {
              original_file: file.name,
              split_index: i + 1,
              split_total: totalConversations,
              split_date: new Date().toISOString(),
            }
          };
          zip.file(filename, JSON.stringify(enrichedConversation, null, 2));
        }
        
        // Update progress every 10 conversations or at the end
        if (i % 10 === 0 || i === data.length - 1) {
          setSplitProgress(prev => prev ? {
            ...prev,
            processedConversations: i + 1
          } : null);
          
          // Yield to UI thread
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      setSplitProgress(prev => prev ? { ...prev, status: 'zipping' } : null);

      // Generate the zip file
      const zipBlob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      }, (metadata) => {
        if (metadata.percent && metadata.percent % 10 === 0) {
          console.log(`Zip progress: ${metadata.percent.toFixed(0)}%`);
        }
      });

      // Create download link
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      
      // Generate zip filename from original file
      const originalName = file.name.replace(/\.json$/i, '');
      const formatLabel = splitOutputFormat === 'pdf' ? 'pdfs' : 'jsons';
      a.download = `${originalName}_${totalConversations}_${formatLabel}.zip`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSplitProgress(prev => prev ? { ...prev, status: 'done' } : null);
      setMessage({ 
        type: 'success', 
        text: `Successfully created ${totalConversations} ${splitOutputFormat.toUpperCase()} files! Download started.` 
      });
    } catch (error) {
      setSplitProgress(prev => prev ? { ...prev, status: 'error' } : null);
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Failed to split file' 
      });
    } finally {
      setIsSplitting(false);
      // Reset file input
      if (splitFileInputRef.current) {
        splitFileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Import / Export
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('export')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'export'
                ? 'text-green-600 border-b-2 border-green-600'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Download className="w-4 h-4 inline-block mr-2" />
            Export
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'import'
                ? 'text-green-600 border-b-2 border-green-600'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Upload className="w-4 h-4 inline-block mr-2" />
            Import
          </button>
          <button
            onClick={() => setActiveTab('tools')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'tools'
                ? 'text-green-600 border-b-2 border-green-600'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Scissors className="w-4 h-4 inline-block mr-2" />
            Tools
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
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

          {activeTab === 'export' ? (
            <div className="space-y-4">
              {/* Export Scope */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  What to export
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600">
                    <input
                      type="radio"
                      name="exportScope"
                      value="current"
                      checked={exportScope === 'current'}
                      onChange={() => setExportScope('current')}
                      className="w-4 h-4 text-green-600"
                    />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">Current conversation</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {currentConversation?.title || 'No conversation selected'}
                      </div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600">
                    <input
                      type="radio"
                      name="exportScope"
                      value="all"
                      checked={exportScope === 'all'}
                      onChange={() => setExportScope('all')}
                      className="w-4 h-4 text-green-600"
                    />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">All conversations</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Export your complete history</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Export Format */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Export format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {formatOptions.map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer border-2 transition-colors ${
                        exportFormat === option.value
                          ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="exportFormat"
                        value={option.value}
                        checked={exportFormat === option.value}
                        onChange={() => setExportFormat(option.value)}
                        className="sr-only"
                      />
                      {option.icon}
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white text-sm">{option.label}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{option.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={handleExport}
                disabled={isExporting || (exportScope === 'current' && !currentConversation)}
                className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Export
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Import conversations from JSON files exported from L_EXE, ChatGPT, LibreChat, or other compatible formats.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />

              {/* Progress indicator during import */}
              {isImporting && importProgress && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                      <span className="font-medium text-blue-700 dark:text-blue-400">
                        {importProgress.status === 'parsing' ? 'Parsing file...' : 
                         importProgress.status === 'importing' ? `Importing batch ${importProgress.currentBatch} of ${importProgress.totalBatches}...` :
                         'Done!'}
                      </span>
                    </div>
                    <button
                      onClick={handleCancelImport}
                      className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
                    >
                      Cancel
                    </button>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${importProgress.totalConversations > 0 
                          ? (importProgress.processedConversations / importProgress.totalConversations) * 100 
                          : 0}%` 
                      }}
                    />
                  </div>
                  
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {importProgress.processedConversations} / {importProgress.totalConversations} conversations processed
                  </div>
                </div>
              )}

              {/* File upload button */}
              {!isImporting && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  className="w-full py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-green-500 dark:hover:border-green-500 transition-colors flex flex-col items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400"
                >
                  <Upload className="w-8 h-8" />
                  <span>Click to select a JSON file</span>
                  <span className="text-xs">Large files will be automatically batched</span>
                </button>
              )}

              {importResult && (() => {
                const skipped = importResult.results?.filter(r => r.error === 'Conversation already imported').length ?? 0;
                const actualErrors = importResult.failed - skipped;
                
                return (
                <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg space-y-3">
                  <h4 className="font-medium text-gray-900 dark:text-white">Import Summary</h4>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li className="flex justify-between">
                      <span>Total conversations:</span>
                      <span className="font-medium">{importResult.total}</span>
                    </li>
                    <li className="flex justify-between text-green-600 dark:text-green-400">
                      <span>New imports:</span>
                      <span className="font-medium">{importResult.successful}</span>
                    </li>
                    {skipped > 0 && (
                      <li className="flex justify-between text-yellow-600 dark:text-yellow-400">
                        <span>Already existed:</span>
                        <span className="font-medium">{skipped}</span>
                      </li>
                    )}
                    {actualErrors > 0 && (
                      <li className="flex justify-between text-red-500">
                        <span>Failed:</span>
                        <span className="font-medium">{actualErrors}</span>
                      </li>
                    )}
                    <li className="flex justify-between">
                      <span>Total messages:</span>
                      <span className="font-medium">
                        {importResult.results?.reduce((sum, r) => sum + r.messagesImported, 0) ?? 0}
                      </span>
                    </li>
                  </ul>
                  
                  {/* Unique Profiles Section */}
                  {importResult.uniqueProfiles && importResult.uniqueProfiles.length > 0 && (
                    <div className="pt-3 border-t border-gray-200 dark:border-gray-600">
                      <h5 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                        Extracted Custom Instructions ({importResult.uniqueProfiles.length} unique)
                      </h5>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {importResult.uniqueProfiles.map((profile) => (
                          <div 
                            key={profile.id}
                            className="text-xs p-2 bg-gray-200 dark:bg-gray-600 rounded"
                          >
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-medium text-gray-700 dark:text-gray-300">
                                Profile #{profile.id}
                              </span>
                              <span className="text-gray-500 dark:text-gray-400">
                                {profile.conversationCount} conversations
                              </span>
                            </div>
                            <p className="text-gray-600 dark:text-gray-400 line-clamp-2">
                              {profile.content.substring(0, 150)}...
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                );
              })()}

              <div className="text-xs text-gray-500 dark:text-gray-400">
                <strong>Supported formats:</strong>
                <ul className="list-disc list-inside mt-1">
                  <li>L_EXE JSON export</li>
                  <li>ChatGPT conversations.json</li>
                  <li>LibreChat export format</li>
                </ul>
              </div>
            </div>
          )}

          {/* Tools Tab */}
          {activeTab === 'tools' && (
            <div className="space-y-4">
              {/* Conversation Splitter Tool */}
              <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                    <Scissors className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white">
                      Conversation Splitter
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Split a large JSON export into individual files
                    </p>
                  </div>
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Upload a JSON file containing multiple conversations (like a ChatGPT export).
                  Each conversation will be saved as a separate file, then bundled into a downloadable ZIP.
                </p>

                {/* Output Format Selector */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Output format
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label
                      className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer border-2 transition-colors ${
                        splitOutputFormat === 'json'
                          ? 'border-purple-600 bg-purple-50 dark:bg-purple-900/20'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                      }`}
                    >
                      <input
                        type="radio"
                        name="splitFormat"
                        value="json"
                        checked={splitOutputFormat === 'json'}
                        onChange={() => setSplitOutputFormat('json')}
                        className="sr-only"
                      />
                      <FileJson className="w-5 h-5 text-purple-600" />
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white text-sm">JSON</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Re-importable data</div>
                      </div>
                    </label>
                    <label
                      className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer border-2 transition-colors ${
                        splitOutputFormat === 'pdf'
                          ? 'border-purple-600 bg-purple-50 dark:bg-purple-900/20'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                      }`}
                    >
                      <input
                        type="radio"
                        name="splitFormat"
                        value="pdf"
                        checked={splitOutputFormat === 'pdf'}
                        onChange={() => setSplitOutputFormat('pdf')}
                        className="sr-only"
                      />
                      <FileText className="w-5 h-5 text-red-600" />
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white text-sm">PDF</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Readable documents</div>
                      </div>
                    </label>
                  </div>
                </div>

                <input
                  ref={splitFileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleSplitFile}
                  className="hidden"
                />

                {/* Progress indicator during split */}
                {isSplitting && splitProgress && (
                  <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg space-y-3 mb-4">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
                      <span className="font-medium text-purple-700 dark:text-purple-400">
                        {splitProgress.status === 'parsing' ? 'Parsing JSON file...' :
                         splitProgress.status === 'splitting' ? `Creating ${splitOutputFormat.toUpperCase()} files...` :
                         splitProgress.status === 'zipping' ? 'Creating ZIP file...' :
                         'Done!'}
                      </span>
                    </div>
                    
                    {splitProgress.totalConversations > 0 && (
                      <>
                        {/* Progress bar */}
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div 
                            className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                            style={{ 
                              width: `${(splitProgress.processedConversations / splitProgress.totalConversations) * 100}%` 
                            }}
                          />
                        </div>
                        
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {splitProgress.processedConversations} / {splitProgress.totalConversations} conversations processed
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Upload button */}
                {!isSplitting && (
                  <button
                    onClick={() => splitFileInputRef.current?.click()}
                    className="w-full py-4 border-2 border-dashed border-purple-300 dark:border-purple-600 rounded-lg hover:border-purple-500 dark:hover:border-purple-500 transition-colors flex flex-col items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400"
                  >
                    <Package className="w-6 h-6" />
                    <span className="font-medium">Select JSON file to split</span>
                    <span className="text-xs">
                      Output: ZIP with {splitOutputFormat === 'pdf' ? 'PDF documents' : 'JSON files'}
                    </span>
                  </button>
                )}

                <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                  <strong>How it works:</strong>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li>Parses your JSON array of conversations</li>
                    <li>Creates a separate {splitOutputFormat === 'pdf' ? 'PDF document' : 'JSON file'} for each</li>
                    <li>Names files using conversation title or ID</li>
                    <li>Packages everything into a compressed ZIP</li>
                    {splitOutputFormat === 'pdf' && (
                      <li>PDFs include formatted messages with styling</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
