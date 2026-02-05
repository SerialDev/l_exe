/**
 * ModelSelector Component
 * Dropdown for selecting AI model and endpoint
 */

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Sparkles } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { AVAILABLE_MODELS } from '../../types';
import clsx from 'clsx';

export function ModelSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const { selectedModel, setModel, setEndpoint } = useChatStore();
  
  const currentModel = AVAILABLE_MODELS.find(m => m.id === selectedModel) || AVAILABLE_MODELS[0];
  
  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const handleSelectModel = (modelId: string) => {
    const model = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (model) {
      setModel(model.id);
      setEndpoint(model.endpoint);
    }
    setIsOpen(false);
  };
  
  // Group models by endpoint
  const modelsByEndpoint = AVAILABLE_MODELS.reduce((acc, model) => {
    if (!acc[model.endpoint]) {
      acc[model.endpoint] = [];
    }
    acc[model.endpoint].push(model);
    return acc;
  }, {} as Record<string, typeof AVAILABLE_MODELS>);
  
  const endpointLabels: Record<string, string> = {
    openAI: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    azure: 'Azure OpenAI',
  };
  
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
      >
        <Sparkles className="w-4 h-4 text-purple-500" />
        <span className="font-medium text-gray-900 dark:text-white">
          {currentModel.name}
        </span>
        <ChevronDown className={clsx(
          'w-4 h-4 text-gray-500 transition-transform',
          isOpen && 'rotate-180'
        )} />
      </button>
      
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2 z-50">
          {Object.entries(modelsByEndpoint).map(([endpoint, models]) => (
            <div key={endpoint}>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                {endpointLabels[endpoint] || endpoint}
              </div>
              
              {models.map((model) => (
                <button
                  key={model.id}
                  onClick={() => handleSelectModel(model.id)}
                  className={clsx(
                    'w-full flex items-center justify-between px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
                    model.id === selectedModel && 'bg-gray-100 dark:bg-gray-700'
                  )}
                >
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white text-left">
                      {model.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 text-left">
                      {(model.contextWindow / 1000).toFixed(0)}K context
                    </div>
                  </div>
                  
                  {model.id === selectedModel && (
                    <Check className="w-4 h-4 text-green-500" />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
