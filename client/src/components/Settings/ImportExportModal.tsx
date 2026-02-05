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
} from 'lucide-react';
import * as api from '../../services/api';
import { useChatStore } from '../../stores/chatStore';

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

export function ImportExportModal({ isOpen, onClose }: ImportExportModalProps) {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [exportScope, setExportScope] = useState<'current' | 'all'>('current');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [importResult, setImportResult] = useState<api.ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    setIsImporting(true);
    setMessage(null);
    setImportResult(null);

    try {
      const result = await api.importConversations(file);
      setImportResult(result);
      
      if (result.success) {
        setMessage({ 
          type: 'success', 
          text: `Imported ${result.conversationsImported} conversations with ${result.messagesImported} messages` 
        });
        // Refresh conversation list
        loadConversations();
      } else {
        setMessage({ type: 'error', text: result.errors.join(', ') || 'Import failed' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Import failed' });
    } finally {
      setIsImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
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

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="w-full py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-green-500 dark:hover:border-green-500 transition-colors flex flex-col items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-8 h-8 animate-spin" />
                    <span>Importing...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8" />
                    <span>Click to select a JSON file</span>
                    <span className="text-xs">or drag and drop</span>
                  </>
                )}
              </button>

              {importResult && (
                <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
                  <h4 className="font-medium text-gray-900 dark:text-white mb-2">Import Summary</h4>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>Conversations: {importResult.conversationsImported}</li>
                    <li>Messages: {importResult.messagesImported}</li>
                    {importResult.errors.length > 0 && (
                      <li className="text-red-500">Errors: {importResult.errors.length}</li>
                    )}
                  </ul>
                </div>
              )}

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
        </div>
      </div>
    </div>
  );
}
