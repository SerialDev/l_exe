/**
 * Speech Service
 * Provides Speech-to-Text (STT) and Text-to-Speech (TTS) capabilities.
 * 
 * Supported providers:
 * - OpenAI (Whisper for STT, TTS-1 for TTS)
 * - Azure Cognitive Services
 * - ElevenLabs (TTS only)
 * - Deepgram (STT only)
 */

// =============================================================================
// Types
// =============================================================================

export type STTProvider = 'openai' | 'azure' | 'deepgram' | 'whisper';
export type TTSProvider = 'openai' | 'azure' | 'elevenlabs';

export type TTSVoice = 
  | 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'  // OpenAI
  | 'en-US-JennyNeural' | 'en-US-GuyNeural' | 'en-GB-SoniaNeural'  // Azure
  | 'rachel' | 'drew' | 'clyde' | 'paul' | 'domi' | 'dave' | 'fin' | 'sarah';  // ElevenLabs

export interface STTResult {
  text: string;
  language?: string;
  confidence?: number;
  duration?: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence?: number;
  }>;
}

export interface TTSResult {
  audio: ArrayBuffer;
  contentType: string;
  duration?: number;
}

export interface STTOptions {
  language?: string;
  prompt?: string;
  temperature?: number;
  timestampGranularities?: ('word' | 'segment')[];
}

export interface TTSOptions {
  voice?: TTSVoice;
  speed?: number;  // 0.25 to 4.0
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  model?: string;
}

export interface SpeechConfig {
  sttProvider: STTProvider;
  ttsProvider: TTSProvider;
  openaiApiKey?: string;
  azureApiKey?: string;
  azureRegion?: string;
  elevenlabsApiKey?: string;
  deepgramApiKey?: string;
  defaultVoice?: TTSVoice;
  defaultLanguage?: string;
}

// =============================================================================
// OpenAI Speech
// =============================================================================

async function transcribeWithOpenAI(
  audio: ArrayBuffer,
  apiKey: string,
  options: STTOptions = {}
): Promise<STTResult> {
  const formData = new FormData();
  formData.append('file', new Blob([audio]), 'audio.webm');
  formData.append('model', 'whisper-1');
  
  if (options.language) {
    formData.append('language', options.language);
  }
  if (options.prompt) {
    formData.append('prompt', options.prompt);
  }
  if (options.temperature !== undefined) {
    formData.append('temperature', options.temperature.toString());
  }
  if (options.timestampGranularities) {
    formData.append('response_format', 'verbose_json');
    for (const gran of options.timestampGranularities) {
      formData.append('timestamp_granularities[]', gran);
    }
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`OpenAI STT error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as any;

  return {
    text: data.text,
    language: data.language,
    duration: data.duration,
    words: data.words?.map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
  };
}

async function synthesizeWithOpenAI(
  text: string,
  apiKey: string,
  options: TTSOptions = {}
): Promise<TTSResult> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model || 'tts-1',
      input: text,
      voice: options.voice || 'alloy',
      speed: options.speed || 1.0,
      response_format: options.format || 'mp3',
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI TTS error: ${response.status} ${await response.text()}`);
  }

  const audio = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'audio/mpeg';

  return { audio, contentType };
}

// =============================================================================
// Azure Cognitive Services Speech
// =============================================================================

async function transcribeWithAzure(
  audio: ArrayBuffer,
  apiKey: string,
  region: string,
  options: STTOptions = {}
): Promise<STTResult> {
  const language = options.language || 'en-US';
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${language}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'audio/wav',
    },
    body: audio,
  });

  if (!response.ok) {
    throw new Error(`Azure STT error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as any;

  return {
    text: data.DisplayText || data.RecognizedText,
    confidence: data.Confidence,
    duration: data.Duration ? data.Duration / 10000000 : undefined, // Convert from 100-nanosecond units
  };
}

async function synthesizeWithAzure(
  text: string,
  apiKey: string,
  region: string,
  options: TTSOptions = {}
): Promise<TTSResult> {
  const voice = options.voice || 'en-US-JennyNeural';
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  const ssml = `
    <speak version='1.0' xml:lang='en-US'>
      <voice name='${voice}'>
        <prosody rate='${((options.speed || 1) * 100).toFixed(0)}%'>
          ${escapeXml(text)}
        </prosody>
      </voice>
    </speak>
  `;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
    },
    body: ssml,
  });

  if (!response.ok) {
    throw new Error(`Azure TTS error: ${response.status} ${await response.text()}`);
  }

  const audio = await response.arrayBuffer();

  return {
    audio,
    contentType: 'audio/mpeg',
  };
}

// =============================================================================
// ElevenLabs TTS
// =============================================================================

const ELEVENLABS_VOICES: Record<string, string> = {
  rachel: '21m00Tcm4TlvDq8ikWAM',
  drew: '29vD33N1CtxCmqQRPOHJ',
  clyde: '2EiwWnXFnvU5JabPnv8n',
  paul: '5Q0t7uMcjvnagumLfvZi',
  domi: 'AZnzlk1XvdvUeBnXmlld',
  dave: 'CYw3kZ02Hs0563khs1Fj',
  fin: 'D38z5RcWu1voky8WS1ja',
  sarah: 'EXAVITQu4vr4xnSDxMaL',
};

async function synthesizeWithElevenLabs(
  text: string,
  apiKey: string,
  options: TTSOptions = {}
): Promise<TTSResult> {
  const voiceName = (options.voice || 'rachel') as string;
  const voiceId = ELEVENLABS_VOICES[voiceName] || voiceName;

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: options.model || 'eleven_monolingual_v1',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5,
        speed: options.speed || 1.0,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS error: ${response.status} ${await response.text()}`);
  }

  const audio = await response.arrayBuffer();

  return {
    audio,
    contentType: 'audio/mpeg',
  };
}

// =============================================================================
// Deepgram STT
// =============================================================================

async function transcribeWithDeepgram(
  audio: ArrayBuffer,
  apiKey: string,
  options: STTOptions = {}
): Promise<STTResult> {
  const params = new URLSearchParams({
    model: 'nova-2',
    smart_format: 'true',
  });

  if (options.language) {
    params.set('language', options.language);
  }

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'audio/webm',
    },
    body: audio,
  });

  if (!response.ok) {
    throw new Error(`Deepgram STT error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as any;
  const result = data.results?.channels?.[0]?.alternatives?.[0];

  return {
    text: result?.transcript || '',
    confidence: result?.confidence,
    words: result?.words?.map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
    })),
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// =============================================================================
// Speech Service Class
// =============================================================================

export class SpeechService {
  private config: SpeechConfig;

  constructor(config: SpeechConfig) {
    this.config = config;
  }

  /**
   * Transcribe audio to text
   */
  async transcribe(audio: ArrayBuffer, options: STTOptions = {}): Promise<STTResult> {
    const { sttProvider } = this.config;

    switch (sttProvider) {
      case 'openai':
      case 'whisper':
        if (!this.config.openaiApiKey) {
          throw new Error('OpenAI API key required for STT');
        }
        return transcribeWithOpenAI(audio, this.config.openaiApiKey, options);

      case 'azure':
        if (!this.config.azureApiKey || !this.config.azureRegion) {
          throw new Error('Azure API key and region required for STT');
        }
        return transcribeWithAzure(audio, this.config.azureApiKey, this.config.azureRegion, options);

      case 'deepgram':
        if (!this.config.deepgramApiKey) {
          throw new Error('Deepgram API key required for STT');
        }
        return transcribeWithDeepgram(audio, this.config.deepgramApiKey, options);

      default:
        throw new Error(`Unknown STT provider: ${sttProvider}`);
    }
  }

  /**
   * Synthesize text to speech
   */
  async synthesize(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    const { ttsProvider } = this.config;
    const finalOptions: TTSOptions = {
      voice: this.config.defaultVoice,
      ...options,
    };

    switch (ttsProvider) {
      case 'openai':
        if (!this.config.openaiApiKey) {
          throw new Error('OpenAI API key required for TTS');
        }
        return synthesizeWithOpenAI(text, this.config.openaiApiKey, finalOptions);

      case 'azure':
        if (!this.config.azureApiKey || !this.config.azureRegion) {
          throw new Error('Azure API key and region required for TTS');
        }
        return synthesizeWithAzure(text, this.config.azureApiKey, this.config.azureRegion, finalOptions);

      case 'elevenlabs':
        if (!this.config.elevenlabsApiKey) {
          throw new Error('ElevenLabs API key required for TTS');
        }
        return synthesizeWithElevenLabs(text, this.config.elevenlabsApiKey, finalOptions);

      default:
        throw new Error(`Unknown TTS provider: ${ttsProvider}`);
    }
  }

  /**
   * Get available voices for current TTS provider
   */
  getVoices(): Array<{ id: string; name: string; preview?: string }> {
    switch (this.config.ttsProvider) {
      case 'openai':
        return [
          { id: 'alloy', name: 'Alloy' },
          { id: 'echo', name: 'Echo' },
          { id: 'fable', name: 'Fable' },
          { id: 'onyx', name: 'Onyx' },
          { id: 'nova', name: 'Nova' },
          { id: 'shimmer', name: 'Shimmer' },
        ];

      case 'azure':
        return [
          { id: 'en-US-JennyNeural', name: 'Jenny (US)' },
          { id: 'en-US-GuyNeural', name: 'Guy (US)' },
          { id: 'en-GB-SoniaNeural', name: 'Sonia (UK)' },
          { id: 'en-AU-NatashaNeural', name: 'Natasha (AU)' },
        ];

      case 'elevenlabs':
        return [
          { id: 'rachel', name: 'Rachel' },
          { id: 'drew', name: 'Drew' },
          { id: 'clyde', name: 'Clyde' },
          { id: 'paul', name: 'Paul' },
          { id: 'domi', name: 'Domi' },
          { id: 'dave', name: 'Dave' },
          { id: 'fin', name: 'Fin' },
          { id: 'sarah', name: 'Sarah' },
        ];

      default:
        return [];
    }
  }

  /**
   * Check if STT is available
   */
  isSTTAvailable(): boolean {
    switch (this.config.sttProvider) {
      case 'openai':
      case 'whisper':
        return !!this.config.openaiApiKey;
      case 'azure':
        return !!this.config.azureApiKey && !!this.config.azureRegion;
      case 'deepgram':
        return !!this.config.deepgramApiKey;
      default:
        return false;
    }
  }

  /**
   * Check if TTS is available
   */
  isTTSAvailable(): boolean {
    switch (this.config.ttsProvider) {
      case 'openai':
        return !!this.config.openaiApiKey;
      case 'azure':
        return !!this.config.azureApiKey && !!this.config.azureRegion;
      case 'elevenlabs':
        return !!this.config.elevenlabsApiKey;
      default:
        return false;
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create speech service instance
 */
export function createSpeechService(config: SpeechConfig): SpeechService {
  return new SpeechService(config);
}

/**
 * Create speech service from environment
 */
export function createSpeechServiceFromEnv(env: {
  STT_PROVIDER?: string;
  TTS_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  ELEVENLABS_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
  DEFAULT_TTS_VOICE?: string;
}): SpeechService {
  return new SpeechService({
    sttProvider: (env.STT_PROVIDER || 'openai') as STTProvider,
    ttsProvider: (env.TTS_PROVIDER || 'openai') as TTSProvider,
    openaiApiKey: env.OPENAI_API_KEY,
    azureApiKey: env.AZURE_SPEECH_KEY,
    azureRegion: env.AZURE_SPEECH_REGION,
    elevenlabsApiKey: env.ELEVENLABS_API_KEY,
    deepgramApiKey: env.DEEPGRAM_API_KEY,
    defaultVoice: env.DEFAULT_TTS_VOICE as TTSVoice,
  });
}
