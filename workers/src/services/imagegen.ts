/**
 * Image Generation Service
 * Supports multiple image generation providers.
 * 
 * Providers:
 * - OpenAI DALL-E 2/3
 * - Stability AI (Stable Diffusion)
 * - Replicate (various models)
 * - Cloudflare Workers AI
 */

// =============================================================================
// Types
// =============================================================================

export type ImageGenProvider = 'openai' | 'stability' | 'replicate' | 'workers-ai';

export type ImageSize = '256x256' | '512x512' | '1024x1024' | '1024x1792' | '1792x1024';
export type ImageQuality = 'standard' | 'hd';
export type ImageStyle = 'vivid' | 'natural';

export interface GeneratedImage {
  url?: string;
  base64?: string;
  revisedPrompt?: string;
}

export interface ImageGenResult {
  images: GeneratedImage[];
  provider: string;
  model: string;
  prompt: string;
  revisedPrompt?: string;
}

export interface ImageGenOptions {
  prompt: string;
  negativePrompt?: string;
  size?: ImageSize;
  quality?: ImageQuality;
  style?: ImageStyle;
  n?: number;  // Number of images
  model?: string;
  seed?: number;
  steps?: number;
  cfgScale?: number;
  responseFormat?: 'url' | 'b64_json';
}

export interface ImageEditOptions {
  image: ArrayBuffer;
  mask?: ArrayBuffer;
  prompt: string;
  size?: ImageSize;
  n?: number;
  responseFormat?: 'url' | 'b64_json';
}

export interface ImageVariationOptions {
  image: ArrayBuffer;
  n?: number;
  size?: ImageSize;
  responseFormat?: 'url' | 'b64_json';
}

export interface ImageGenConfig {
  provider: ImageGenProvider;
  openaiApiKey?: string;
  stabilityApiKey?: string;
  replicateApiKey?: string;
  workersAiBinding?: any;  // AI binding from Cloudflare
  defaultModel?: string;
  defaultSize?: ImageSize;
}

// =============================================================================
// OpenAI DALL-E
// =============================================================================

async function generateWithOpenAI(
  options: ImageGenOptions,
  apiKey: string
): Promise<ImageGenResult> {
  const model = options.model || 'dall-e-3';
  const isDalle3 = model === 'dall-e-3';

  const body: Record<string, unknown> = {
    model,
    prompt: options.prompt,
    size: options.size || (isDalle3 ? '1024x1024' : '512x512'),
    n: isDalle3 ? 1 : (options.n || 1),  // DALL-E 3 only supports n=1
    response_format: options.responseFormat || 'url',
  };

  if (isDalle3) {
    body.quality = options.quality || 'standard';
    body.style = options.style || 'vivid';
  }

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI image generation failed: ${error}`);
  }

  const data = await response.json() as any;

  return {
    images: data.data.map((img: any) => ({
      url: img.url,
      base64: img.b64_json,
      revisedPrompt: img.revised_prompt,
    })),
    provider: 'openai',
    model,
    prompt: options.prompt,
    revisedPrompt: data.data[0]?.revised_prompt,
  };
}

async function editWithOpenAI(
  options: ImageEditOptions,
  apiKey: string
): Promise<ImageGenResult> {
  const formData = new FormData();
  formData.append('image', new Blob([options.image]), 'image.png');
  formData.append('prompt', options.prompt);
  formData.append('model', 'dall-e-2');  // Only DALL-E 2 supports editing
  formData.append('size', options.size || '512x512');
  formData.append('n', (options.n || 1).toString());
  formData.append('response_format', options.responseFormat || 'url');

  if (options.mask) {
    formData.append('mask', new Blob([options.mask]), 'mask.png');
  }

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI image edit failed: ${error}`);
  }

  const data = await response.json() as any;

  return {
    images: data.data.map((img: any) => ({
      url: img.url,
      base64: img.b64_json,
    })),
    provider: 'openai',
    model: 'dall-e-2',
    prompt: options.prompt,
  };
}

async function variationsWithOpenAI(
  options: ImageVariationOptions,
  apiKey: string
): Promise<ImageGenResult> {
  const formData = new FormData();
  formData.append('image', new Blob([options.image]), 'image.png');
  formData.append('model', 'dall-e-2');
  formData.append('size', options.size || '512x512');
  formData.append('n', (options.n || 1).toString());
  formData.append('response_format', options.responseFormat || 'url');

  const response = await fetch('https://api.openai.com/v1/images/variations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI image variations failed: ${error}`);
  }

  const data = await response.json() as any;

  return {
    images: data.data.map((img: any) => ({
      url: img.url,
      base64: img.b64_json,
    })),
    provider: 'openai',
    model: 'dall-e-2',
    prompt: 'variation',
  };
}

// =============================================================================
// Stability AI
// =============================================================================

async function generateWithStability(
  options: ImageGenOptions,
  apiKey: string
): Promise<ImageGenResult> {
  const model = options.model || 'stable-diffusion-xl-1024-v1-0';
  
  // Parse size
  const [width, height] = (options.size || '1024x1024').split('x').map(Number);

  const body: Record<string, unknown> = {
    text_prompts: [
      { text: options.prompt, weight: 1 },
    ],
    cfg_scale: options.cfgScale || 7,
    height,
    width,
    steps: options.steps || 30,
    samples: options.n || 1,
  };

  if (options.negativePrompt) {
    (body.text_prompts as any[]).push({ text: options.negativePrompt, weight: -1 });
  }

  if (options.seed !== undefined) {
    body.seed = options.seed;
  }

  const response = await fetch(
    `https://api.stability.ai/v1/generation/${model}/text-to-image`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Stability AI generation failed: ${error}`);
  }

  const data = await response.json() as any;

  return {
    images: data.artifacts.map((artifact: any) => ({
      base64: artifact.base64,
    })),
    provider: 'stability',
    model,
    prompt: options.prompt,
  };
}

// =============================================================================
// Replicate
// =============================================================================

async function generateWithReplicate(
  options: ImageGenOptions,
  apiKey: string
): Promise<ImageGenResult> {
  // Default to SDXL
  const model = options.model || 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b';

  // Parse size
  const [width, height] = (options.size || '1024x1024').split('x').map(Number);

  const input: Record<string, unknown> = {
    prompt: options.prompt,
    width,
    height,
    num_outputs: options.n || 1,
  };

  if (options.negativePrompt) {
    input.negative_prompt = options.negativePrompt;
  }
  if (options.seed !== undefined) {
    input.seed = options.seed;
  }
  if (options.steps) {
    input.num_inference_steps = options.steps;
  }
  if (options.cfgScale) {
    input.guidance_scale = options.cfgScale;
  }

  // Create prediction
  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: model.includes(':') ? model.split(':')[1] : model,
      input,
    }),
  });

  if (!createResponse.ok) {
    const error = await createResponse.text();
    throw new Error(`Replicate prediction creation failed: ${error}`);
  }

  const prediction = await createResponse.json() as any;

  // Poll for completion
  let result = prediction;
  while (result.status !== 'succeeded' && result.status !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const pollResponse = await fetch(result.urls.get, {
      headers: { 'Authorization': `Token ${apiKey}` },
    });
    result = await pollResponse.json();
  }

  if (result.status === 'failed') {
    throw new Error(`Replicate prediction failed: ${result.error}`);
  }

  const images = Array.isArray(result.output) ? result.output : [result.output];

  return {
    images: images.map((url: string) => ({ url })),
    provider: 'replicate',
    model,
    prompt: options.prompt,
  };
}

// =============================================================================
// Cloudflare Workers AI
// =============================================================================

async function generateWithWorkersAI(
  options: ImageGenOptions,
  ai: any
): Promise<ImageGenResult> {
  const model = options.model || '@cf/stabilityai/stable-diffusion-xl-base-1.0';

  const input: Record<string, unknown> = {
    prompt: options.prompt,
  };

  if (options.negativePrompt) {
    input.negative_prompt = options.negativePrompt;
  }
  if (options.steps) {
    input.num_steps = options.steps;
  }

  const response = await ai.run(model, input);

  // Workers AI returns raw image bytes
  const base64 = btoa(String.fromCharCode(...new Uint8Array(response)));

  return {
    images: [{ base64 }],
    provider: 'workers-ai',
    model,
    prompt: options.prompt,
  };
}

// =============================================================================
// Image Generation Service Class
// =============================================================================

export class ImageGenService {
  private config: ImageGenConfig;

  constructor(config: ImageGenConfig) {
    this.config = config;
  }

  /**
   * Generate images from text prompt
   */
  async generate(options: ImageGenOptions): Promise<ImageGenResult> {
    const { provider } = this.config;

    switch (provider) {
      case 'openai':
        if (!this.config.openaiApiKey) {
          throw new Error('OpenAI API key required');
        }
        return generateWithOpenAI(options, this.config.openaiApiKey);

      case 'stability':
        if (!this.config.stabilityApiKey) {
          throw new Error('Stability AI API key required');
        }
        return generateWithStability(options, this.config.stabilityApiKey);

      case 'replicate':
        if (!this.config.replicateApiKey) {
          throw new Error('Replicate API key required');
        }
        return generateWithReplicate(options, this.config.replicateApiKey);

      case 'workers-ai':
        if (!this.config.workersAiBinding) {
          throw new Error('Workers AI binding required');
        }
        return generateWithWorkersAI(options, this.config.workersAiBinding);

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Edit an existing image (OpenAI only)
   */
  async edit(options: ImageEditOptions): Promise<ImageGenResult> {
    if (this.config.provider !== 'openai') {
      throw new Error('Image editing only supported with OpenAI');
    }
    if (!this.config.openaiApiKey) {
      throw new Error('OpenAI API key required');
    }
    return editWithOpenAI(options, this.config.openaiApiKey);
  }

  /**
   * Create variations of an image (OpenAI only)
   */
  async variations(options: ImageVariationOptions): Promise<ImageGenResult> {
    if (this.config.provider !== 'openai') {
      throw new Error('Image variations only supported with OpenAI');
    }
    if (!this.config.openaiApiKey) {
      throw new Error('OpenAI API key required');
    }
    return variationsWithOpenAI(options, this.config.openaiApiKey);
  }

  /**
   * Get available models for current provider
   */
  getModels(): Array<{ id: string; name: string }> {
    switch (this.config.provider) {
      case 'openai':
        return [
          { id: 'dall-e-3', name: 'DALL-E 3' },
          { id: 'dall-e-2', name: 'DALL-E 2' },
        ];
      case 'stability':
        return [
          { id: 'stable-diffusion-xl-1024-v1-0', name: 'SDXL 1.0' },
          { id: 'stable-diffusion-v1-6', name: 'SD 1.6' },
        ];
      case 'replicate':
        return [
          { id: 'stability-ai/sdxl', name: 'SDXL' },
          { id: 'stability-ai/stable-diffusion', name: 'Stable Diffusion' },
        ];
      case 'workers-ai':
        return [
          { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL Base' },
          { id: '@cf/lykon/dreamshaper-8-lcm', name: 'Dreamshaper 8' },
        ];
      default:
        return [];
    }
  }

  /**
   * Get supported sizes
   */
  getSizes(): ImageSize[] {
    switch (this.config.provider) {
      case 'openai':
        return ['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024'];
      case 'stability':
      case 'replicate':
      case 'workers-ai':
        return ['512x512', '1024x1024'];
      default:
        return ['1024x1024'];
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createImageGenService(config: ImageGenConfig): ImageGenService {
  return new ImageGenService(config);
}

export function createImageGenServiceFromEnv(env: {
  IMAGE_GEN_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  STABILITY_API_KEY?: string;
  REPLICATE_API_KEY?: string;
  AI?: any;
}): ImageGenService {
  const provider = (env.IMAGE_GEN_PROVIDER || 'openai') as ImageGenProvider;

  return new ImageGenService({
    provider,
    openaiApiKey: env.OPENAI_API_KEY,
    stabilityApiKey: env.STABILITY_API_KEY,
    replicateApiKey: env.REPLICATE_API_KEY,
    workersAiBinding: env.AI,
  });
}
