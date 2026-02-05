/**
 * ArtifactViewer Component
 * Renders various artifact types (React, HTML, Mermaid, SVG, Code, etc.)
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { 
  Code, 
  Eye, 
  Copy, 
  Check, 
  Download, 
  Maximize2, 
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Artifact, ArtifactType } from '../../types';

interface ArtifactViewerProps {
  artifact: Artifact;
  onClose?: () => void;
  expanded?: boolean;
}

interface ParsedArtifact {
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
}

// Parse artifact tags from message content
export function parseArtifacts(content: string): { text: string; artifacts: ParsedArtifact[] } {
  const artifacts: ParsedArtifact[] = [];
  const artifactRegex = /<artifact\s+(?:identifier="[^"]*"\s+)?type="([^"]+)"(?:\s+language="([^"]+)")?(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/artifact>/gi;
  
  let text = content;
  let match;
  
  while ((match = artifactRegex.exec(content)) !== null) {
    const [fullMatch, type, language, title, artifactContent] = match;
    artifacts.push({
      type: type as ArtifactType,
      title: title || `${type} artifact`,
      content: artifactContent.trim(),
      language: language || (type === 'code' ? 'typescript' : undefined),
    });
    
    // Replace artifact tag with a placeholder in text
    text = text.replace(fullMatch, `\n[Artifact: ${title || type}]\n`);
  }
  
  return { text, artifacts };
}

export function ArtifactViewer({ artifact, onClose, expanded = false }: ArtifactViewerProps) {
  const [isExpanded, setIsExpanded] = useState(expanded);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadArtifact = () => {
    const blob = new Blob([artifact.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title || 'artifact'}.${getFileExtension(artifact.type, artifact.language)}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getFileExtension = (type: ArtifactType, language?: string): string => {
    switch (type) {
      case 'react': return 'tsx';
      case 'html': return 'html';
      case 'mermaid': return 'mmd';
      case 'svg': return 'svg';
      case 'markdown': return 'md';
      case 'code': return language || 'txt';
      default: return 'txt';
    }
  };

  const renderPreview = () => {
    switch (artifact.type) {
      case 'html':
        return <HTMLPreview content={artifact.content} />;
      case 'react':
        return <ReactPreview content={artifact.content} />;
      case 'mermaid':
        return <MermaidPreview content={artifact.content} />;
      case 'svg':
        return <SVGPreview content={artifact.content} />;
      case 'markdown':
        return <MarkdownPreview content={artifact.content} />;
      case 'code':
      default:
        return (
          <SyntaxHighlighter
            style={oneDark as { [key: string]: React.CSSProperties }}
            language={artifact.language || 'typescript'}
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: '0.5rem' }}
          >
            {artifact.content}
          </SyntaxHighlighter>
        );
    }
  };

  const containerClass = isFullscreen
    ? 'fixed inset-4 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col'
    : 'border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800';

  return (
    <>
      {/* Fullscreen backdrop */}
      {isFullscreen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsFullscreen(false)}
        />
      )}
      
      <div className={containerClass}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
            <span className="font-medium text-sm text-gray-900 dark:text-white">
              {artifact.title}
            </span>
            <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-gray-600 dark:text-gray-300">
              {artifact.type}
            </span>
          </div>
          
          <div className="flex items-center gap-1">
            {/* Toggle code/preview */}
            {artifact.type !== 'code' && (
              <button
                onClick={() => setShowCode(!showCode)}
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-500 dark:text-gray-400"
                title={showCode ? 'Show preview' : 'Show code'}
              >
                {showCode ? <Eye className="w-4 h-4" /> : <Code className="w-4 h-4" />}
              </button>
            )}
            
            {/* Copy */}
            <button
              onClick={copyToClipboard}
              className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-500 dark:text-gray-400"
              title="Copy code"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
            
            {/* Download */}
            <button
              onClick={downloadArtifact}
              className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-500 dark:text-gray-400"
              title="Download"
            >
              <Download className="w-4 h-4" />
            </button>
            
            {/* Fullscreen */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-500 dark:text-gray-400"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <X className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
        
        {/* Content */}
        {isExpanded && (
          <div className={`overflow-auto ${isFullscreen ? 'flex-1' : 'max-h-[400px]'}`}>
            {showCode ? (
              <SyntaxHighlighter
                style={oneDark as { [key: string]: React.CSSProperties }}
                language={artifact.language || getLanguageForType(artifact.type)}
                PreTag="div"
                customStyle={{ margin: 0, borderRadius: 0 }}
              >
                {artifact.content}
              </SyntaxHighlighter>
            ) : (
              <div className="p-4">
                {renderPreview()}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function getLanguageForType(type: ArtifactType): string {
  switch (type) {
    case 'react': return 'tsx';
    case 'html': return 'html';
    case 'mermaid': return 'markdown';
    case 'svg': return 'xml';
    case 'markdown': return 'markdown';
    default: return 'typescript';
  }
}

// HTML Preview - renders in sandboxed iframe using srcdoc for security
function HTMLPreview({ content }: { content: string }) {
  // Sanitize HTML content to prevent XSS
  const sanitizedContent = useMemo(() => {
    return DOMPurify.sanitize(content, {
      ADD_TAGS: ['style', 'link'],
      ADD_ATTR: ['target', 'rel'],
      ALLOW_DATA_ATTR: true,
    });
  }, [content]);

  // Wrap in a basic HTML document structure
  const fullHtml = useMemo(() => {
    // Check if content is already a full HTML document
    if (sanitizedContent.toLowerCase().includes('<!doctype') || 
        sanitizedContent.toLowerCase().includes('<html')) {
      return sanitizedContent;
    }
    // Wrap in basic structure
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>body { margin: 8px; font-family: system-ui, sans-serif; }</style>
</head>
<body>${sanitizedContent}</body>
</html>`;
  }, [sanitizedContent]);

  return (
    <iframe
      srcDoc={fullHtml}
      className="w-full min-h-[300px] border-0 bg-white rounded"
      sandbox="allow-scripts allow-same-origin"
      title="HTML Preview"
    />
  );
}

// React Preview - renders React code in iframe with React runtime
function ReactPreview({ content }: { content: string }) {
  const htmlContent = useMemo(() => {
    // Escape content for safe embedding in script tag
    // We don't sanitize React code since it needs to execute
    // The iframe sandbox provides isolation
    const escapedContent = content
      .replace(/</g, '\\x3c')
      .replace(/>/g, '\\x3e');
    
    // Wrap React code in a full HTML document with React runtime
    // Using srcdoc for security instead of contentDocument.write
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js" crossorigin></script>
  <script src="https://cdn.tailwindcss.com" crossorigin></script>
  <style>
    body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; }
    #root { min-height: 100px; }
    .error { color: red; padding: 16px; background: #fee; border-radius: 8px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    try {
      // Unescape the content
      const code = "${escapedContent}".replace(/\\\\x3c/g, '<').replace(/\\\\x3e/g, '>');
      
      // Evaluate the code (this is intentional for React preview)
      eval(code);
      
      // Try to find and render the default export or App component
      const Component = typeof App !== 'undefined' ? App : 
                       typeof default_1 !== 'undefined' ? default_1 :
                       () => <div className="error">No component found to render</div>;
      
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(<Component />);
    } catch (error) {
      document.getElementById('root').innerHTML = '<div class="error">Error: ' + error.message + '</div>';
    }
  </script>
</body>
</html>`;
  }, [content]);

  return (
    <iframe
      srcDoc={htmlContent}
      className="w-full min-h-[300px] border-0 bg-white rounded"
      sandbox="allow-scripts"
      title="React Preview"
    />
  );
}

// Mermaid Preview - renders Mermaid diagrams
function MermaidPreview({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Dynamically load mermaid
    const loadMermaid = async () => {
      try {
        // @ts-ignore
        if (!window.mermaid) {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
          script.crossOrigin = 'anonymous';
          script.onload = () => renderDiagram();
          document.head.appendChild(script);
        } else {
          renderDiagram();
        }
      } catch (err) {
        setError('Failed to load Mermaid');
      }
    };

    const renderDiagram = async () => {
      try {
        // @ts-ignore
        const mermaid = window.mermaid;
        mermaid.initialize({ startOnLoad: false, theme: 'default' });
        
        const { svg } = await mermaid.render('mermaid-' + Date.now(), content);
        // Sanitize the SVG output from Mermaid
        const sanitizedSvg = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
        setSvg(sanitizedSvg);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to render diagram');
      }
    };

    loadMermaid();
  }, [content]);

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// SVG Preview - renders SVG directly with sanitization
function SVGPreview({ content }: { content: string }) {
  // Sanitize SVG content to prevent XSS attacks
  const sanitizedContent = useMemo(() => {
    return DOMPurify.sanitize(content, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
  }, [content]);

  return (
    <div 
      className="flex justify-center"
      dangerouslySetInnerHTML={{ __html: sanitizedContent }}
    />
  );
}

// Markdown Preview - simple markdown rendering with sanitization
function MarkdownPreview({ content }: { content: string }) {
  // Basic markdown to HTML conversion (for a real app, use a proper markdown parser)
  const html = useMemo(() => {
    let result = content
      // Headers
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>')
      // Bold
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      // Code
      .replace(/`([^`]+)`/gim, '<code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-sm">$1</code>')
      // Links - sanitize URL to prevent javascript: protocol
      .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, (_, text, url) => {
        // Only allow http, https, and mailto protocols
        const safeUrl = url.match(/^(https?:|mailto:)/i) ? url : '#';
        return `<a href="${safeUrl}" class="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">${text}</a>`;
      })
      // Line breaks
      .replace(/\n/gim, '<br>');
    
    // Sanitize the final HTML
    return DOMPurify.sanitize(result, {
      ADD_ATTR: ['target', 'rel', 'class'],
    });
  }, [content]);

  return (
    <div 
      className="prose dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Inline artifact display for messages
interface InlineArtifactProps {
  artifact: ParsedArtifact;
}

export function InlineArtifact({ artifact }: InlineArtifactProps) {
  const [expanded, setExpanded] = useState(false);

  // Create a minimal Artifact object for the viewer
  const fullArtifact: Artifact = {
    id: crypto.randomUUID(),
    conversationId: '',
    messageId: '',
    type: artifact.type,
    title: artifact.title,
    content: artifact.content,
    language: artifact.language,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return (
    <div className="my-4">
      <ArtifactViewer artifact={fullArtifact} expanded={expanded} />
    </div>
  );
}

export default ArtifactViewer;
